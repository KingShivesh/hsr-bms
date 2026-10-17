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
import "./presentation.css";
import "./perceived-speed.css";
import "./product/product-shell.css";
import "./legacy-presentation.css";
import "./interaction-polish.css";
import App from "./App.jsx";

window.HSRTheme.sync();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
