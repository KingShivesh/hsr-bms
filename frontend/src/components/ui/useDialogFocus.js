import { useEffect } from "react";

let scrollLocks = 0;
let savedScrollStyles;
function lockPageScroll() {
  if (scrollLocks++ === 0) {
    savedScrollStyles = [document.body.style.overflow, document.body.style.paddingRight];
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    if (gutter > 0) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + gutter}px`;
    document.body.style.overflow = "hidden";
  }
  return () => {
    if (--scrollLocks === 0) [document.body.style.overflow, document.body.style.paddingRight] = savedScrollStyles;
  };
}

export function useDialogScrollLock(open) {
  useEffect(() => {
    if (open) return lockPageScroll();
  }, [open]);
}

export function topDialog() {
  const depth = node => {
    let layer = 0;
    for (let parent = node; parent; parent = parent.parentElement) layer = Math.max(layer, Number.parseInt(getComputedStyle(parent).zIndex, 10) || 0);
    return layer;
  };
  return [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
    .filter(node => node.getClientRects().length && !node.closest('[aria-hidden="true"],[inert]') && getComputedStyle(node).visibility !== "hidden")
    .sort((a, b) => depth(a) - depth(b)).at(-1);
}

export function useDialogFocus(ref, open, initialFocusRef) {
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const unlock = lockPageScroll();
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
      unlock();
      requestAnimationFrame(() => { const top = topDialog(); if (opener?.isConnected && (!top || top.contains(opener))) opener.focus(); });
    };
  }, [ref, open, initialFocusRef]);
}
