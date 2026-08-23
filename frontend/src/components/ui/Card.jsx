export function Panel({ children, className = "", as: Component = "section", ...props }) {
  return (
    <Component className={["ui-panel", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </Component>
  );
}

export default function Card({ children, className = "", interactive = false, as: Component = "div", ...props }) {
  return (
    <Component
      className={["ui-card", interactive ? "is-interactive" : "", className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </Component>
  );
}
