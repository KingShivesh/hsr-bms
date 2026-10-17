import { useId, useState } from "react";
import Button from "./Button.jsx";
import Icon from "./Icon.jsx";

export default function Disclosure({ title, icon, children, defaultOpen = false, disabled = false, className = "", headerClassName = "" }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return <section className={`ui-disclosure ${className}`} data-open={open}>
    <Button native type="button" className={`ui-disclosure-trigger ${headerClassName}`} disabled={disabled} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      {icon && <Icon name={icon} />}<span>{title}</span><Icon name="chevron-down" className="ui-disclosure-chevron" />
    </Button>
    <div id={id} hidden={!open} className="ui-disclosure-body">{children}</div>
  </section>;
}
