import { Icon } from "../components/ui/index.js";

export default function ContextHelp({ label, children }) {
  return <details className="product-context-help"><summary aria-label={label} title={label}><Icon name="info-circle" /></summary><div>{children}</div></details>;
}
