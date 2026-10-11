import { useEffect } from "react";

export function useEscapeKey(onClose, active = true) {
  useEffect(() => {
    if (!active || typeof onClose !== "function") return;

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      event.stopPropagation();
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, active]);
}

export default useEscapeKey;
