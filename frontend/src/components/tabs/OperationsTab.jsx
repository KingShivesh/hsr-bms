import { useState, useEffect } from "react";
import {
  getPeakHours,
  addPeakHour,
  deletePeakHour,
  getGST,
  saveGST,
  getCurrentRate,
} from "../../api/index.js";
import { useToast } from "../toastContext.js";

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: "var(--text-sm)",
        padding: "6px 18px",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
        background: active ? "var(--text-primary)" : "var(--surface)",
        color: active ? "var(--surface)" : "var(--text-secondary)",
        border: active ? "1px solid var(--text-primary)" : "1px solid var(--border)",
      }}
    >
      {children}
    </button>
  );
}

function Panel({ title, description, children }) {
  return (
    <div className="settings-panel">
      <div
        style={{
          marginBottom: "16px",
          paddingBottom: "12px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="settings-panel-title">{title}</div>
        {description && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: "3px" }}>
            {description}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Peak Hours ──
function PeakHoursView() {
  const { showToast } = useToast();
  const [rules, setRules] = useState([]);
  const [currentRate, setCurrentRate] = useState(null);
  const [startHour, setStartHour] = useState(18);
  const [endHour, setEndHour] = useState(22);
  const [multiplier, setMultiplier] = useState(1.5);
  const [label, setLabel] = useState("Evening Peak");
  const [activeAction, setActiveAction] = useState("");

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    try {
      const [rRes, cRes] = await Promise.all([
        getPeakHours(),
        getCurrentRate(),
      ]);
      setRules(rRes.data);
      setCurrentRate(cRes.data);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleAdd() {
    if (startHour >= endHour) {
      showToast("Start hour must be before end hour", "error");
      return;
    }
    setActiveAction("peak-add");
    try {
      await addPeakHour(
        parseInt(startHour),
        parseInt(endHour),
        parseFloat(multiplier),
        label,
      );
      await fetchAll();
      showToast("Peak hour rule added", "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to add peak hour rule", "error");
    } finally {
      setActiveAction("");
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this rule?")) return;
    setActiveAction(`peak-delete-${id}`);
    try {
      await deletePeakHour(id);
      await fetchAll();
      showToast("Peak hour rule deleted", "success");
    } catch {
      showToast("Failed to delete peak hour rule", "error");
    } finally {
      setActiveAction("");
    }
  }

  function fmtHour(h) {
    return `${String(h).padStart(2, "0")}:00`;
  }

  return (
    <Panel
      title="Peak Hour Rates"
      description="Automatically apply a rate multiplier during busy hours"
    >
      {/* Current rate indicator */}
      {currentRate && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 14px",
            background: currentRate.is_peak ? "var(--warning-bg)" : "var(--success-bg)",
            border: `1px solid ${currentRate.is_peak ? "color-mix(in srgb, var(--warning) 28%, var(--border))" : "color-mix(in srgb, var(--success) 28%, var(--border))"}`,
            borderRadius: "var(--radius-sm)",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: currentRate.is_peak ? "var(--warning)" : "var(--success)",
            }}
          />
          <div
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-medium)",
              color: currentRate.is_peak ? "var(--warning)" : "var(--success)",
            }}
          >
            {currentRate.is_peak
              ? `${currentRate.label} active — ${currentRate.multiplier}× rate`
              : "Standard rate currently active"}
          </div>
        </div>
      )}

      {/* Existing rules */}
      {rules.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          {rules.map((r, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 12px",
                background: "var(--surface-muted)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                marginBottom: "8px",
              }}
            >
              <div>
                <div
                  style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}
                >
                  {r.label}
                </div>
                <div
                  style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: "2px" }}
                >
                  {fmtHour(r.start_hour)} – {fmtHour(r.end_hour)} ·{" "}
                  {r.multiplier}× rate
                </div>
              </div>
              <button
                onClick={() => handleDelete(r.id)}
                disabled={!!activeAction}
                style={{
                  fontSize: "var(--text-xs)",
                  padding: "4px 10px",
                  borderRadius: "var(--radius-sm)",
                  cursor: activeAction ? "wait" : "pointer",
                  background: "var(--danger-bg)",
                  color: "var(--danger)",
                  border: "1px solid color-mix(in srgb, var(--danger) 24%, var(--border))",
                  fontWeight: "var(--weight-medium)",
                }}
              >
                {activeAction === `peak-delete-${r.id}` ? "Deleting..." : "Delete"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new rule */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div>
          <label className="form-label">Label</label>
          <input
            className="input-field"
            style={{ margin: 0, width: "140px" }}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <label className="form-label">Start Hour</label>
          <input
            type="number"
            min="0"
            max="23"
            className="input-field"
            style={{ margin: 0, width: "90px" }}
            value={startHour}
            onChange={(e) => setStartHour(e.target.value)}
          />
        </div>
        <div>
          <label className="form-label">End Hour</label>
          <input
            type="number"
            min="1"
            max="24"
            className="input-field"
            style={{ margin: 0, width: "90px" }}
            value={endHour}
            onChange={(e) => setEndHour(e.target.value)}
          />
        </div>
        <div>
          <label className="form-label">Multiplier</label>
          <input
            type="number"
            min="1"
            max="5"
            step="0.1"
            className="input-field"
            style={{ margin: 0, width: "90px" }}
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
          />
        </div>
        <button
          className="btn btn-primary-sm"
          style={{ marginBottom: "1px" }}
          onClick={handleAdd}
          disabled={!!activeAction}
        >
          {activeAction === "peak-add" ? "Adding..." : "Add Rule"}
        </button>
      </div>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: "8px" }}>
        Example: Start 18, End 22, Multiplier 1.5 = 50% surcharge from 6pm to
        10pm
      </div>
    </Panel>
  );
}

// ── GST ──
function GSTView() {
  const { showToast } = useToast();
  const [gst, setGst] = useState(0);
  const [flash, setFlash] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getGST()
      .then((r) => setGst(r.data.gst_percent))
      .catch(console.error);
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await saveGST(parseFloat(gst) || 0);
      setFlash("GST setting saved");
      showToast("GST setting saved", "success");
      setTimeout(() => setFlash(""), 2500);
    } catch {
      showToast("Failed to save GST", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Tax / GST"
      description="Automatically add GST to every bill. Set to 0 to disable."
    >
      {flash && (
        <div
          style={{
            background: "var(--success-bg)",
            border: "1px solid color-mix(in srgb, var(--success) 28%, var(--border))",
            borderRadius: "var(--radius-sm)",
            padding: "8px 12px",
            marginBottom: "12px",
            fontSize: "var(--text-sm)",
            color: "var(--success)",
            fontWeight: "var(--weight-medium)",
          }}
        >
          {flash}
        </div>
      )}

      <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
        <div>
          <label className="form-label">GST Percentage</label>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              className="input-field"
              style={{ margin: 0, width: "120px" }}
              value={gst}
              onChange={(e) => setGst(e.target.value)}
            />
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>%</span>
          </div>
        </div>
        <button
          className="btn btn-primary-sm"
          style={{ marginBottom: "1px" }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {parseFloat(gst) > 0 && (
        <div
          style={{
            marginTop: "12px",
            padding: "10px 14px",
            background: "var(--accent-bg)",
            border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--border))",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--text-sm)",
            color: "var(--accent-text)",
          }}
        >
          A bill of ₹500 will have ₹{Math.round((500 * parseFloat(gst)) / 100)}{" "}
          GST added → Total ₹{500 + Math.round((500 * parseFloat(gst)) / 100)}
        </div>
      )}

      {parseFloat(gst) === 0 && (
        <div style={{ marginTop: "8px", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          GST is currently disabled. Set a percentage above to enable it.
        </div>
      )}
    </Panel>
  );
}

// ── Main Tab ──
export default function OperationsTab() {
  const [activeTab, setActiveTab] = useState("peak");

  const TABS = [
    { id: "peak", label: "Peak Hour Rates" },
    { id: "gst", label: "Tax / GST" },
  ];

  return (
    <div style={{ maxWidth: "780px" }}>
      <div style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
        {TABS.map((t) => (
          <TabBtn
            key={t.id}
            active={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </TabBtn>
        ))}
      </div>

      {activeTab === "peak" && <PeakHoursView />}
      {activeTab === "gst" && <GSTView />}
    </div>
  );
}
