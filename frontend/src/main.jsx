import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import { initAnalytics } from "./services/analytics.js";
import App from "./App.jsx";
import "./index.css";

initAnalytics();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Analytics />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
