import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./style.css";
import "bootstrap/dist/css/bootstrap.min.css";
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
