import { useState, useEffect } from "react";
import {
  getPeakHours,
  addPeakHour,
  updatePeakHour,
  deletePeakHour,
  getGST,
  saveGST,
  getCurrentRate,
} from "../../api/index.js";
import { useToast } from "../toastContext.js";
import { useConfirm } from "../confirmContext.js";
import RetryNotice from "../RetryNotice.jsx";

function TabBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ui-tab-btn ${active ? "active" : ""}`}
    >
      {children}
    </button>
  );
}

function Panel({ title, description, children }) {
  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <div className="settings-panel-title">{title}</div>
        {description && (
          <div className="settings-panel-description">{description}</div>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Peak Hours ──
function PeakHoursView() {
  const { showToast } = useToast();
  const { requestConfirm } = useConfirm();
  const [rules, setRules] = useState([]);
  const [currentRate, setCurrentRate] = useState(null);
  const [startHour, setStartHour] = useState(18);
  const [endHour, setEndHour] = useState(22);
  const [multiplier, setMultiplier] = useState(1.5);
  const [label, setLabel] = useState("Evening Peak");
  const [editingId, setEditingId] = useState(null);
  const [activeAction, setActiveAction] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    try {
      setLoadError("");
      const [rRes, cRes] = await Promise.all([
        getPeakHours(),
        getCurrentRate(),
      ]);
      setRules(rRes.data);
      setCurrentRate(cRes.data);
    } catch (e) {
      console.error(e);
      setLoadError(e.userMessage || "Peak-hour settings could not load.");
    }
  }

  async function handleSaveRule() {
    if (startHour >= endHour) {
      showToast("Start hour must be before end hour", "error");
      return;
    }
    const actionKey = editingId ? `peak-edit-${editingId}` : "peak-add";
    setActiveAction(actionKey);
    try {
      const payload = [
        parseInt(startHour, 10),
        parseInt(endHour, 10),
        parseFloat(multiplier),
        label,
      ];
      if (editingId) {
        await updatePeakHour(editingId, ...payload);
      } else {
        await addPeakHour(...payload);
      }
      await fetchAll();
      showToast(editingId ? "Peak hour rule saved" : "Peak hour rule added", "success");
      setEditingId(null);
      setLabel("Evening Peak");
      setStartHour(18);
      setEndHour(22);
      setMultiplier(1.5);
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to save peak hour rule", "error");
    } finally {
      setActiveAction("");
    }
  }

  function startEdit(rule) {
    setEditingId(rule.id);
    setLabel(rule.label || "Peak Hours");
    setStartHour(rule.start_hour);
    setEndHour(rule.end_hour);
    setMultiplier(rule.multiplier);
  }

  function cancelEdit() {
    setEditingId(null);
    setLabel("Evening Peak");
    setStartHour(18);
    setEndHour(22);
    setMultiplier(1.5);
  }

  async function handleDelete(id) {
    const confirmed = await requestConfirm({
      title: "Delete peak-hour rule?",
      message: "This stops the rate multiplier from applying during that time window.",
      confirmLabel: "Delete Rule",
      tone: "danger",
    });
    if (!confirmed) return;
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
      {loadError && (
        <RetryNotice
          message={loadError}
          detail="Peak-hour rates may be stale until this reloads."
          onRetry={fetchAll}
        />
      )}
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
          type="button"
          className="btn btn-primary-sm"
          style={{ marginBottom: "1px" }}
          onClick={handleSaveRule}
          disabled={!!activeAction}
        >
          {activeAction === "peak-add"
            ? "Adding..."
            : editingId && activeAction === `peak-edit-${editingId}`
              ? "Saving..."
              : editingId
                ? "Save Peak Rule"
                : "Add Peak Rule"}
        </button>
        {editingId && (
          <button
            className="btn"
            style={{ marginBottom: "1px" }}
            onClick={cancelEdit}
            disabled={!!activeAction}
          >
            Discard Rule Edits
          </button>
        )}
      </div>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: "8px" }}>
        Example: Start 18, End 22, Multiplier 1.5 = 50% surcharge from 6pm to
        10pm
      </div>

      <div className="operations-rule-list" aria-label="Existing peak-hour rules">
        <div className="operations-rule-list-head">
          <strong>Existing rules</strong>
          <span>{rules.length} saved</span>
        </div>
        {rules.length === 0 ? (
          <div className="operations-rule-empty">
            No peak-hour rules saved yet.
          </div>
        ) : (
          <div className="operations-rule-table">
            {rules.map((rule) => (
              <div className="operations-rule-row" key={rule.id}>
                <div>
                  <strong>{rule.label}</strong>
                  <span>{fmtHour(rule.start_hour)} - {fmtHour(rule.end_hour)}</span>
                </div>
                <em>{rule.multiplier}x</em>
                <div className="operations-rule-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => startEdit(rule)}
                    disabled={!!activeAction}
                  >
                    Edit Rule
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger-sm"
                    onClick={() => handleDelete(rule.id)}
                    disabled={!!activeAction}
                  >
                    {activeAction === `peak-delete-${rule.id}` ? "Deleting..." : "Delete Rule"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    getGST()
      .then((r) => {
        setLoadError("");
        setGst(r.data.gst_percent);
      })
      .catch((e) => {
        console.error(e);
        setLoadError(e.userMessage || "GST setting could not load.");
      });
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
      {loadError && (
        <RetryNotice
          message={loadError}
          detail="The saved tax value may be stale until this reloads."
          onRetry={() => {
            setLoadError("");
            getGST()
              .then((r) => setGst(r.data.gst_percent))
              .catch((e) => setLoadError(e.userMessage || "GST setting could not load."));
          }}
        />
      )}
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
          {saving ? "Saving..." : "Save GST"}
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
