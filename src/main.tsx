import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./global.css";
import "./styles/tokens.stylex";

if (process.env.NODE_ENV !== "production") {
  const stylexStylesheet = document.createElement("link");
  stylexStylesheet.rel = "stylesheet";
  stylexStylesheet.href = "/stylex.dev.css";
  document.head.append(stylexStylesheet);
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
