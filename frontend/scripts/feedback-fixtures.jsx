/* eslint-disable react-refresh/only-export-components -- Browser-only test mount helpers, not an app refresh boundary. */
import { createElement, Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../src/components/Toast.jsx";
import { useToast } from "../src/components/toastContext.js";
import Button, { IconButton } from "../src/components/ui/Button.jsx";
import { Modal } from "../src/components/ui/Overlay.jsx";

function host(id) {
  const node = document.createElement("div");
  node.id = id;
  node.style.cssText = "position:fixed;inset:0;z-index:1000;background:var(--surface);padding:20px";
  document.body.append(node);
  return node;
}
function FeedbackFixture() {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  window.__notify = showToast;
  window.__showModal = setOpen;
  return createElement(Fragment, null,
    createElement(Button, { onClick: () => setOpen(true) }, "Open QA dialog"),
    createElement(Modal, { open, portal: true, title: "QA lifecycle", onClose: () => setOpen(false) }, "Dialog contents"));
}
export function mountFeedbackFixture() {
  window.__undoCalls = 0;
  createRoot(host("qa-feedback-fixture")).render(createElement(ToastProvider, null, createElement(FeedbackFixture)));
}
export function mountAsyncButtonsFixture() {
  window.__buttonCalls = {}; window.__buttonResolvers = {};
  const make = name => () => {
    window.__buttonCalls[name] = (window.__buttonCalls[name] || 0) + 1;
    return new Promise(resolve => { window.__buttonResolvers[name] = resolve; });
  };
  createRoot(host("qa-buttons-fixture")).render(createElement("div", null,
    createElement(Button, { onClick: make("standard"), "data-testid": "standard" }, "Save a longer label"),
    createElement(Button, { native: true, onClick: make("native"), "data-testid": "native" }, "Native action"),
    createElement(IconButton, { onClick: make("icon"), "data-testid": "icon", label: "Retry", icon: "ti-refresh" })));
}
