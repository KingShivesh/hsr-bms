import { useEffect } from "react";

export function useEscapeKey(onClose, active = true) {
  useEffect(() => {
    if (!active || typeof onClose !== "function") return;

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;

      const activeEl = document.activeElement;
      const isInput =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT");

      if (isInput && activeEl.value && String(activeEl.value).trim().length > 0) {
        activeEl.blur();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, active]);
}

export default useEscapeKey;
