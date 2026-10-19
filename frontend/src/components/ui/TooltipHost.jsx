import { useEffect, useId, useState } from "react";
import Overlay from "react-bootstrap/Overlay";

export default function TooltipHost() {
  const id = useId();
  const [tip, setTip] = useState(null);
  useEffect(() => {
    let timer, target, originalTitle, description;
    function clear() {
      clearTimeout(timer);
      if (target) {
        if (originalTitle !== null) target.setAttribute("title", originalTitle);
        if (description) target.setAttribute("aria-describedby", description);
        else target.removeAttribute("aria-describedby");
      }
      target = null;
      setTip(null);
    }
    function show(event) {
      const node = event.target.closest?.("[data-tooltip],button[title]");
      if (!node || node === target || node.contains(event.relatedTarget)) return;
      clear();
      const text = node.dataset.tooltip || node.title;
      if (!text) return;
      target = node;
      originalTitle = node.getAttribute("title");
      description = node.getAttribute("aria-describedby");
      node.removeAttribute("title");
      timer = setTimeout(() => {
        node.setAttribute("aria-describedby", [description, id].filter(Boolean).join(" "));
        setTip({ target: node, text });
      }, event.type === "focusin" ? 0 : 300);
    }
    function hide(event) {
      if (target?.contains(event.relatedTarget)) return;
      clear();
    }
    function key(event) { if (event.key === "Escape") clear(); }
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", hide);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", clear, true);
    return () => {
      clear();
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", hide);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", clear, true);
    };
  }, [id]);
  return <Overlay target={tip?.target} show={!!tip} placement="top" transition={false}
    popperConfig={{ strategy: "fixed", modifiers: [{ name: "flip", enabled: true }, { name: "preventOverflow", options: { padding: 8 } }, { name: "offset", options: { offset: [0, 8] } }] }}>
    {({ ref, style }) => <div ref={ref} style={style} id={id} role="tooltip" className="hsr-tooltip">{tip?.text}</div>}
  </Overlay>;
}
