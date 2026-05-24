// Per-test-file setup, wired via vitest's `setupFiles` in vite.config.js.
//
// Imports @testing-library/jest-dom for its side effect: registering custom
// matchers on Vitest's `expect` (toBeInTheDocument, toBeDisabled,
// toHaveTextContent, toHaveAttribute, etc.). Without this the matchers
// exist as strings but throw "expect(...).toBeInTheDocument is not a
// function" at use time — easy to fix once you see it, bewildering on
// first encounter.
import "@testing-library/jest-dom/vitest";
