import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
