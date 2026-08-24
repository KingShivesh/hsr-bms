import { createElement } from "react";

export function Panel({ children, className = "", as = "section", ...props }) {
  return createElement(
    as,
    { className: ["ui-panel", className].filter(Boolean).join(" "), ...props },
    children,
  );
}

export default function Card({ children, className = "", interactive = false, as = "div", ...props }) {
  return createElement(
    as,
    {
      className: ["ui-card", interactive ? "is-interactive" : "", className].filter(Boolean).join(" "),
      ...props,
    },
    children,
  );
}
