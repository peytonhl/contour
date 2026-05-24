// Tests for <LoadMoreButton/> — the shared "load more" CTA used by
// ReviewSection, ReplyThread, ProfilePage tabs, UserPage tabs.
//
// The standards this primitive exists to enforce — min hit target, disabled
// during load, aria-busy for screen readers — are exactly the kind of thing
// that regresses when someone tweaks the styles. These tests pin the
// behavior so future style changes can't silently break the contract.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoadMoreButton } from "./LoadMoreButton.jsx";

describe("<LoadMoreButton/>", () => {
  it("renders the default 'Load more' label", () => {
    render(<LoadMoreButton onClick={() => {}} loading={false} />);
    expect(screen.getByRole("button", { name: /load more/i })).toBeInTheDocument();
  });

  it("uses a custom label when provided", () => {
    render(<LoadMoreButton onClick={() => {}} loading={false} label="Load more replies" />);
    expect(screen.getByRole("button", { name: "Load more replies" })).toBeInTheDocument();
  });

  it("calls onClick when not loading", async () => {
    const onClick = vi.fn();
    render(<LoadMoreButton onClick={onClick} loading={false} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled while loading and shows 'Loading…' label", () => {
    render(<LoadMoreButton onClick={() => {}} loading={true} label="Load more replies" />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Loading…");
  });

  it("marks aria-busy=true while loading for screen readers", () => {
    // Prevents the loading state from being treated as a navigation target —
    // SR users would otherwise be told 'press button' when the button is
    // actively in-flight.
    render(<LoadMoreButton onClick={() => {}} loading={true} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });

  it("does NOT have aria-busy when idle", () => {
    render(<LoadMoreButton onClick={() => {}} loading={false} />);
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-busy");
  });

  it("does not call onClick while loading (defends against double-fetch)", async () => {
    // Even though disabled prevents user clicks, programmatic .click() can
    // still fire. The disabled attribute alone is the primary defense;
    // pinning the contract so a future refactor that drops `disabled` for
    // styling reasons can't silently re-enable double-fetch.
    const onClick = vi.fn();
    render(<LoadMoreButton onClick={onClick} loading={true} />);
    // userEvent respects disabled and silently no-ops — exactly the user
    // experience we want.
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("meets the 44px iOS HIG hit target", () => {
    // The hit target standard is what the helper exists to enforce —
    // without this test the styles could drift below 44px and we'd only
    // catch it on a real device.
    render(<LoadMoreButton onClick={() => {}} loading={false} />);
    const btn = screen.getByRole("button");
    const styles = btn.style;
    // minHeight is passed via inline style, so we can read it directly.
    expect(styles.minHeight).toBe("44px");
  });
});
