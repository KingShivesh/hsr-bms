import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Button from "./Button.jsx";

export default function Dropdown({ label, children, trigger, className = "" }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({});
  const button = useRef(null);
  const popup = useRef(null);
  const initialItem = useRef("first");
  const id = useId();
  const items = () => [...(popup.current?.querySelectorAll('[role="menuitem"]') || [])]
    .filter(node => !node.disabled && node.getAttribute("aria-disabled") !== "true" && node.getClientRects().length);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = button.current.getBoundingClientRect();
    const menu = popup.current.getBoundingClientRect();
    setPosition({
      top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - menu.height - 8)),
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - menu.width - 8)),
    });
    const enabled = items();
    (initialItem.current === "last" ? enabled.at(-1) : enabled[0])?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = event => {
      if (!popup.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const closeAndRestore = () => { setOpen(false); button.current?.focus(); };
  return <>
    <Button native ref={button} className={className} aria-label={label} title={label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { initialItem.current = "first"; setOpen(value => !value); }}
      onKeyDown={event => {
        if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
        event.preventDefault();
        initialItem.current = event.key === "ArrowUp" ? "last" : "first";
        setOpen(true);
      }}>
      {trigger}
    </Button>
    {open && createPortal(<div id={id} className="ui-dropdown" role="menu" aria-label={label} ref={popup} style={position}
      onClick={event => {
        const item = event.target.closest('[role="menuitem"]');
        if (item && !item.disabled && item.getAttribute("aria-disabled") !== "true") closeAndRestore();
      }}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeAndRestore(); return; }
        // Let native Tab continue from the trigger, not the detached portal.
        if (event.key === "Tab") { closeAndRestore(); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const enabled = items();
        const index = enabled.indexOf(document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
        enabled[next]?.focus();
      }}>{children}</div>, document.body)}
  </>;
}
