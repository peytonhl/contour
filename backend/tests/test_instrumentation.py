"""Tests for the lightweight counter registry.

The int32-overflow bug went undetected for an entire session because
silent failures had no observability. This registry is the productionized
version of the ad-hoc counters that eventually surfaced it. These tests
pin the contract so future write-path instrumentation has a stable surface.
"""
from __future__ import annotations

import pytest

from services import instrumentation


@pytest.fixture(autouse=True)
def isolate_registry(monkeypatch):
    """Each test gets a fresh registry. Without this, counters leak
    across tests because the registry is module-level state."""
    monkeypatch.setattr(instrumentation, "_REGISTRY", {})


def test_counter_returns_block_with_standard_fields():
    block = instrumentation.counter("test.op")
    assert block["called_total"] == 0
    assert block["last_at_utc"] is None
    assert block["last_outcome"] is None
    assert block["last_subject"] is None


def test_counter_with_custom_buckets():
    block = instrumentation.counter(
        "db.save",
        row_found_total=0,
        row_missing_total=0,
        committed_total=0,
    )
    assert block["row_found_total"] == 0
    assert block["committed_total"] == 0


def test_counter_idempotent_registration():
    """Re-importing a module shouldn't reset its counters."""
    a = instrumentation.counter("test.op", successes=0)
    instrumentation.record(a, outcome="ok", successes=1)
    assert a["successes"] == 1

    b = instrumentation.counter("test.op", successes=0)
    # Same dict, not a fresh one — counters survive re-registration.
    assert b is a
    assert b["successes"] == 1


def test_record_increments_standard_and_custom_fields():
    block = instrumentation.counter("db.write", success_total=0, error_total=0)

    instrumentation.record(block, outcome="ok", subject="row-1", success_total=1)
    assert block["called_total"] == 1
    assert block["success_total"] == 1
    assert block["error_total"] == 0
    assert block["last_outcome"] == "ok"
    assert block["last_subject"] == "row-1"
    assert block["last_at_utc"] is not None

    instrumentation.record(block, outcome="ValueError: oops", subject="row-2", error_total=1)
    assert block["called_total"] == 2
    assert block["success_total"] == 1
    assert block["error_total"] == 1
    assert block["last_outcome"] == "ValueError: oops"
    assert block["last_subject"] == "row-2"


def test_record_handles_unknown_field_by_creating_it():
    """Forgiving: a record() that names a bucket not declared at
    counter() time just creates the bucket. Avoids crashes when a new
    outcome branch is added without updating the registration."""
    block = instrumentation.counter("db.write")

    instrumentation.record(block, outcome="rare_case", new_bucket=1)
    assert block["new_bucket"] == 1


def test_snapshot_returns_independent_copy():
    a = instrumentation.counter("op.a", x=0)
    b = instrumentation.counter("op.b", y=0)
    instrumentation.record(a, outcome="hit", x=1)
    instrumentation.record(b, outcome="miss", y=2)

    snap = instrumentation.snapshot()
    assert set(snap.keys()) == {"op.a", "op.b"}
    assert snap["op.a"]["x"] == 1
    assert snap["op.b"]["y"] == 2

    # Mutating the snapshot must not affect the live registry.
    snap["op.a"]["x"] = 999
    assert a["x"] == 1
