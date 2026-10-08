import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "bootstrap/dist/css/bootstrap.min.css";
import "@fontsource-variable/syne";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./style.css";
import "./design-tokens.css";
import "./table-states.css";
import App from "./App.jsx";

const storedDarkMode = localStorage.getItem("darkMode");
if (storedDarkMode === null || storedDarkMode === "true") {
  document.body.classList.add("dark");
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
