import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { createSvgRenderer } from "./render/native";
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

try {
  const response = await fetch("/public/renderer/kor.wasm");
  if (!response.ok) throw new Error(`SVG renderer could not be loaded (${response.status}).`);
  const renderer = await createSvgRenderer(await response.arrayBuffer());
  createRoot(root).render(
    <StrictMode>
      <App renderer={renderer} />
    </StrictMode>,
  );
} catch (error) {
  const message = document.createElement("p");
  message.textContent = error instanceof Error ? error.message : "The SVG renderer could not start.";
  root.replaceChildren(message);
  console.error(error);
}
