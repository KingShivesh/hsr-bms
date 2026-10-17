import { useEffect } from "react";
import { topDialog } from "./useDialogFocus.js";

export function useEscapeKey(onClose, active = true, dialogRef) {
  useEffect(() => {
    if (!active || typeof onClose !== "function") return;

    function handleKeyDown(event) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (dialogRef?.current && topDialog() !== dialogRef.current) return;

      event.preventDefault();
      event.stopPropagation();
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, active, dialogRef]);
}

export default useEscapeKey;
