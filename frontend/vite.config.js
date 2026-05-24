/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vitest config lives alongside Vite config because that's the supported
// integration path — `vitest` reads the `test` block here at run time and
// shares the same React plugin pipeline, so component tests get the same
// JSX transform Vite uses for the actual app build.
export default defineConfig({
  plugins: [react()],
  test: {
    // jsdom gives us a real DOM in Node — Testing Library renders into it
    // and we can query/interact with components the same way a browser does.
    environment: "jsdom",
    // setupFiles runs ONCE per test file, before any tests in it. We use it
    // to extend Vitest's expect() with @testing-library/jest-dom's matchers
    // (toBeInTheDocument, toBeDisabled, etc.) — without this they exist but
    // produce TypeScript-like "not a function" errors at use time.
    setupFiles: ["./src/test/setup.js"],
    // `globals: true` makes describe/it/expect available without imports —
    // matches the muscle memory most React devs have from Jest and matches
    // what our backend pytest does (no `import pytest` per test).
    globals: true,
    // Vitest's default include pattern. Listing it explicitly so a future
    // refactor doesn't have to re-derive what's covered.
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
  },
  server: {
    proxy: {
      "/albums": "http://localhost:8000",
      "/tracks": "http://localhost:8000",
      "/artists": "http://localhost:8000",
      "/compare": "http://localhost:8000",
      "/comparisons": "http://localhost:8000",
      "/ratings": "http://localhost:8000",
      "/auth/login": "http://localhost:8000",
      "/auth/callback": "http://localhost:8000",
      "/auth/me": "http://localhost:8000",
      "/auth/profile": "http://localhost:8000",
      "/featured": "http://localhost:8000",
      "/feed": "http://localhost:8000",
      "/users": "http://localhost:8000",
      "/reviews": "http://localhost:8000",
      "/health": "http://localhost:8000",
    },
  },
});
