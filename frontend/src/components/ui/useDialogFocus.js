import { useEffect } from "react";

export function topDialog() {
  const depth = node => {
    let layer = 0;
    for (let parent = node; parent; parent = parent.parentElement) layer = Math.max(layer, Number.parseInt(getComputedStyle(parent).zIndex, 10) || 0);
    return layer;
  };
  return [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
    .filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== "hidden")
    .sort((a, b) => depth(a) - depth(b)).at(-1);
}

export function useDialogFocus(ref, open, initialFocusRef) {
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const opener = document.activeElement;
    const controls = () => [...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"]),summary')]
      .filter(node => node.tabIndex >= 0 && node.getClientRects().length && getComputedStyle(node).visibility !== "hidden");
    const frame = requestAnimationFrame(() => { if (topDialog() === dialog) (initialFocusRef?.current || controls()[0] || dialog).focus(); });
    const trap = event => {
      if (event.key !== "Tab" || event.defaultPrevented || topDialog() !== dialog) return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      cancelAnimationFrame(frame); document.removeEventListener("keydown", trap);
      requestAnimationFrame(() => { const top = topDialog(); if (opener?.isConnected && (!top || top.contains(opener))) opener.focus(); });
    };
  }, [ref, open, initialFocusRef]);
}
