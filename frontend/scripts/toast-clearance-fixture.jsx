/* eslint-disable react-refresh/only-export-components -- Isolated real-component browser fixture. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../src/components/Toast.jsx";
import { useToast } from "../src/components/toastContext.js";
import { Button, Modal, Table } from "../src/components/ui/index.js";

function Workspace() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [retries, setRetries] = useState(0);
  const { showToast, dismissToast } = useToast();
  window.qaNotify = showToast;
  window.qaDismiss = dismissToast;
  window.qaOpenDialog = () => setOpen(true);
  return <main className="main-content" style={{ margin: 0, width: "100%", padding: 20 }}>
    <h1>QA order history</h1>
    <Table><thead><tr><th>Item</th><th>State</th></tr></thead><tbody>{Array.from({ length: 24 }, (_, i) => <tr key={i} style={{ height: 44 }}><td>QA record {i + 1}</td><td>Recorded</td></tr>)}</tbody></Table>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 64 }}><span>Page {page}</span><Button onClick={() => setPage(value => value + 1)}>Next records</Button></div>
    <Modal open={open} portal title="QA recovery" onClose={() => setOpen(false)} footer={<Button onClick={() => setRetries(value => value + 1)}>Retry QA action</Button>}><p>QA failure recovery</p><span>Attempts {retries}</span></Modal>
  </main>;
}

export function mountToastClearanceFixture() {
  document.getElementById("root").style.display = "none";
  const host = document.createElement("div");
  host.id = "qa-toast-clearance";
  document.body.append(host);
  createRoot(host).render(<ToastProvider><Workspace /></ToastProvider>);
}
