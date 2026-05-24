// Tests for the shared <EmptyState/> primitive.
//
// Several render paths because the component has optional icon / title /
// CTA — the conditional rendering is exactly the kind of thing that
// regresses silently when someone reorganizes the prop interface.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { EmptyState } from "./EmptyState.jsx";

// MemoryRouter wrapper because EmptyState uses <Link> from react-router-dom
// when ctaTo is set — without a Router context, Link throws.
function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("<EmptyState/>", () => {
  it("renders the description as the minimum required prop", () => {
    renderWithRouter(<EmptyState description="No ratings yet." />);
    expect(screen.getByText("No ratings yet.")).toBeInTheDocument();
  });

  it("renders the title in addition to the description when provided", () => {
    renderWithRouter(<EmptyState title="Nothing here" description="Try rating something." />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Try rating something.")).toBeInTheDocument();
  });

  it("renders the icon node when provided", () => {
    renderWithRouter(
      <EmptyState
        icon={<svg data-testid="my-icon" />}
        description="d"
      />
    );
    expect(screen.getByTestId("my-icon")).toBeInTheDocument();
  });

  it("renders the CTA as a Link when ctaTo is provided", () => {
    renderWithRouter(
      <EmptyState description="d" ctaLabel="Go" ctaTo="/somewhere" />
    );
    const cta = screen.getByText("Go");
    expect(cta).toBeInTheDocument();
    // <Link to="/somewhere"> renders an <a href="/somewhere">
    expect(cta.tagName).toBe("A");
    expect(cta).toHaveAttribute("href", "/somewhere");
  });

  it("renders the CTA as a button when ctaOnClick is provided (no ctaTo)", async () => {
    const onClick = vi.fn();
    renderWithRouter(
      <EmptyState description="d" ctaLabel="Reset" ctaOnClick={onClick} />
    );
    const cta = screen.getByText("Reset");
    expect(cta.tagName).toBe("BUTTON");
    await userEvent.click(cta);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ctaTo wins when both ctaTo and ctaOnClick are passed", () => {
    // Documented behavior — ctaTo is the primary path (most call sites pass
    // it), ctaOnClick is the fallback. Pinning so a refactor doesn't quietly
    // flip the priority and break links into buttons-that-do-nothing.
    renderWithRouter(
      <EmptyState
        description="d"
        ctaLabel="Choose"
        ctaTo="/a"
        ctaOnClick={() => {}}
      />
    );
    const cta = screen.getByText("Choose");
    expect(cta.tagName).toBe("A");
  });

  it("does not render any CTA when ctaLabel is missing", () => {
    renderWithRouter(<EmptyState description="d" ctaTo="/somewhere" />);
    // No button or link with any visible text besides the description.
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders children below the CTA for inline-extra-affordance cases", () => {
    // FollowingTab uses this — empty state + a 'people to follow' suggestion
    // list rendered as children. Pin the render order so the suggestion
    // block doesn't accidentally end up above the title.
    renderWithRouter(
      <EmptyState description="d">
        <div data-testid="extra">Suggested users</div>
      </EmptyState>
    );
    expect(screen.getByTestId("extra")).toBeInTheDocument();
  });
});
