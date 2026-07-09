import { useState, useEffect } from "react";
import {
  getPeakHours,
  addPeakHour,
  deletePeakHour,
  getGST,
  saveGST,
  getCurrentRate,
} from "../../api/index.js";

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: "13px",
        padding: "6px 18px",
        borderRadius: "6px",
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
        background: active ? "#111" : "#fff",
        color: active ? "#fff" : "#888",
        border: active ? "1px solid #111" : "1px solid #e5e5e5",
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
          borderBottom: "1px solid #f0f0f0",
        }}
      >
        <div className="settings-panel-title">{title}</div>
        {description && (
          <div style={{ fontSize: "12px", color: "#bbb", marginTop: "3px" }}>
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
  const [rules, setRules] = useState([]);
  const [currentRate, setCurrentRate] = useState(null);
  const [startHour, setStartHour] = useState(18);
  const [endHour, setEndHour] = useState(22);
  const [multiplier, setMultiplier] = useState(1.5);
  const [label, setLabel] = useState("Evening Peak");

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
      alert("Start hour must be before end hour");
      return;
    }
    try {
      await addPeakHour(
        parseInt(startHour),
        parseInt(endHour),
        parseFloat(multiplier),
        label,
      );
      fetchAll();
    } catch (e) {
      alert(e.response?.data?.detail || "Failed");
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this rule?")) return;
    try {
      await deletePeakHour(id);
      fetchAll();
    } catch {
      alert("Failed");
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
            background: currentRate.is_peak ? "#fffbeb" : "#f0fdf4",
            border: `1px solid ${currentRate.is_peak ? "#fde68a" : "#bbf7d0"}`,
            borderRadius: "8px",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: currentRate.is_peak ? "#d97706" : "#16a34a",
            }}
          />
          <div
            style={{
              fontSize: "13px",
              fontWeight: 500,
              color: currentRate.is_peak ? "#d97706" : "#16a34a",
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
                background: "#fafafa",
                border: "1px solid #f0f0f0",
                borderRadius: "8px",
                marginBottom: "8px",
              }}
            >
              <div>
                <div
                  style={{ fontSize: "13px", fontWeight: 600, color: "#111" }}
                >
                  {r.label}
                </div>
                <div
                  style={{ fontSize: "12px", color: "#888", marginTop: "2px" }}
                >
                  {fmtHour(r.start_hour)} – {fmtHour(r.end_hour)} ·{" "}
                  {r.multiplier}× rate
                </div>
              </div>
              <button
                onClick={() => handleDelete(r.id)}
                style={{
                  fontSize: "11px",
                  padding: "4px 10px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  background: "#fff1f2",
                  color: "#e11d48",
                  border: "1px solid #fecdd3",
                  fontWeight: 500,
                }}
              >
                Delete
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
        >
          Add Rule
        </button>
      </div>
      <div style={{ fontSize: "12px", color: "#bbb", marginTop: "8px" }}>
        Example: Start 18, End 22, Multiplier 1.5 = 50% surcharge from 6pm to
        10pm
      </div>
    </Panel>
  );
}

// ── GST ──
function GSTView() {
  const [gst, setGst] = useState(0);
  const [flash, setFlash] = useState("");

  useEffect(() => {
    getGST()
      .then((r) => setGst(r.data.gst_percent))
      .catch(console.error);
  }, []);

  async function handleSave() {
    try {
      await saveGST(parseFloat(gst) || 0);
      setFlash("GST setting saved");
      setTimeout(() => setFlash(""), 2500);
    } catch {
      alert("Failed to save GST");
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
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "6px",
            padding: "8px 12px",
            marginBottom: "12px",
            fontSize: "12px",
            color: "#16a34a",
            fontWeight: 500,
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
            <span style={{ fontSize: "13px", color: "#888" }}>%</span>
          </div>
        </div>
        <button
          className="btn btn-primary-sm"
          style={{ marginBottom: "1px" }}
          onClick={handleSave}
        >
          Save
        </button>
      </div>

      {parseFloat(gst) > 0 && (
        <div
          style={{
            marginTop: "12px",
            padding: "10px 14px",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#2563eb",
          }}
        >
          A bill of ₹500 will have ₹{Math.round((500 * parseFloat(gst)) / 100)}{" "}
          GST added → Total ₹{500 + Math.round((500 * parseFloat(gst)) / 100)}
        </div>
      )}

      {parseFloat(gst) === 0 && (
        <div style={{ marginTop: "8px", fontSize: "12px", color: "#bbb" }}>
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
