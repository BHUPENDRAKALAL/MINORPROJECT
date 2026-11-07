import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./vendor/foundry/style.css";
import "./index.css";
import App from "./App.tsx";
import { applySavedTheme } from "./app/theme";

applySavedTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
