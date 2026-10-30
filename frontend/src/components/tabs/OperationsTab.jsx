import { Button as HsrButton, Input as HsrInput, SkeletonBlock, Panel as SharedPanel, EmptyState } from "../ui/index.js";
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
    <HsrButton native
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`ui-tab-btn ${active ? "active" : ""}`}
    >
      {children}
    </HsrButton>
  );
}

function Panel({ title, description, children }) {
  return (
    <SharedPanel as="div" className="settings-panel">
      <div className="settings-panel-header">
        <div className="settings-panel-title">{title}</div>
        {description && (
          <div className="settings-panel-description">{description}</div>
        )}
      </div>
      {children}
    </SharedPanel>
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      setLoadError("");
      const [rRes, cRes] = await Promise.all([
        getPeakHours(),
        getCurrentRate(),
      ]);
      if (!Array.isArray(rRes.data) || typeof cRes.data?.is_peak !== "boolean" || !Number.isFinite(cRes.data?.multiplier)) throw new Error("Peak-hour settings unavailable");
      setRules(rRes.data.filter((rule) => rule && typeof rule === "object"));
      setCurrentRate(cRes.data);
    } catch (e) {
      console.error(e);
      setLoadError(e.userMessage || "Peak-hour settings could not load.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveRule() {
    const [start, end, rate] = [startHour, endHour, multiplier].map(Number);
    if ([startHour, endHour, multiplier].some(value => !String(value).trim()) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > 23 || end < 1 || end > 24 || start >= end || !Number.isFinite(rate) || rate <= 0 || rate > 5) {
      showToast("Enter hours from 0–24, with start before end, and a multiplier above 0 up to 5.", "error");
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
    setStartHour(rule.start_hour ?? "");
    setEndHour(rule.end_hour ?? "");
    setMultiplier(rule.multiplier ?? "");
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
    return h == null ? "—" : `${String(h).padStart(2, "0")}:00`;
  }

  if (loading) return <Panel title="Peak Hour Rates"><SkeletonBlock label="Loading peak-hour settings" rows={4} /></Panel>;
  if (loadError && !currentRate) return <Panel title="Peak Hour Rates"><RetryNotice message={loadError} onRetry={fetchAll} /></Panel>;

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
          className="polish-display-flex polish-align-items-center polish-gap-8px polish-padding-8px-12px polish-border-radius-radius-sm polish-margin-bottom-16px" style={{ background: currentRate.is_peak ? "var(--warning-bg)" : "var(--success-bg)", border: `1px solid ${currentRate.is_peak ? "color-mix(in srgb, var(--warning) 28%, var(--border))" : "color-mix(in srgb, var(--success) 28%, var(--border))"}` }}
        >
          <div
            className="polish-width-8px polish-height-8px polish-border-radius-50" style={{ background: currentRate.is_peak ? "var(--warning)" : "var(--success)" }}
          />
          <div className="type-sm polish-font-weight-weight-medium"
            title={currentRate.label || undefined}
            style={{ color: currentRate.is_peak ? "var(--warning-foreground)" : "var(--success-foreground)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {currentRate.is_peak
              ? `${currentRate.label || "Peak hours"} active — ${currentRate.multiplier}× rate`
              : "Standard rate currently active"}
          </div>
        </div>
      )}

      {/* Add new rule */}
      <div
        className="polish-display-flex polish-gap-8px polish-align-items-flex-end polish-flex-wrap-wrap"
      >
        <div>
          <label className="form-label" htmlFor="peak-rule-label">Label</label>
          <HsrInput
            id="peak-rule-label"
            className="input-field polish-margin-0 polish-width-140px"

            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="peak-rule-start">Start Hour</label>
          <HsrInput
            id="peak-rule-start"
            type="number"
            min="0"
            max="23"
            className="input-field polish-margin-0 polish-width-90px"

            value={startHour}
            onChange={(e) => setStartHour(e.target.value)}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="peak-rule-end">End Hour</label>
          <HsrInput
            id="peak-rule-end"
            type="number"
            min="1"
            max="24"
            className="input-field polish-margin-0 polish-width-90px"

            value={endHour}
            onChange={(e) => setEndHour(e.target.value)}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="peak-rule-multiplier">Multiplier</label>
          <HsrInput
            id="peak-rule-multiplier"
            type="number"
            min="1"
            max="5"
            step="0.1"
            className="input-field polish-margin-0 polish-width-90px"

            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
          />
        </div>
        <HsrButton native
          type="button"
          className="btn btn-primary-sm polish-margin-bottom-0px"

          onClick={handleSaveRule}
          disabled={!!activeAction || !!loadError}
          loading={activeAction === "peak-add" || activeAction === `peak-edit-${editingId}`}
        >
          {activeAction === "peak-add"
            ? "Adding..."
            : editingId && activeAction === `peak-edit-${editingId}`
              ? "Saving..."
              : editingId
                ? "Save Peak Rule"
                : "Add Peak Rule"}
        </HsrButton>
        {editingId && (
          <HsrButton native
            className="btn polish-margin-bottom-0px"

            onClick={cancelEdit}
            disabled={!!activeAction}
          >
            Discard Rule Edits
          </HsrButton>
        )}
      </div>
      <div className="type-sm polish-color-text-muted polish-margin-top-8px" >
        Example: Start 18, End 22, Multiplier 1.5 = 50% surcharge from 6pm to
        10pm
      </div>

      <div className="operations-rule-list" aria-label="Existing peak-hour rules">
        <div className="operations-rule-list-head">
          <strong>Existing rules</strong>
          <span>{rules.length} saved</span>
        </div>
        {rules.length === 0 ? (
          <EmptyState icon="ti-clock" title="No peak-hour rules" description="No busy-hour rate windows are configured." action={<HsrButton icon="ti-plus" onClick={() => document.getElementById("peak-rule-label")?.focus()}>New rule</HsrButton>} />
        ) : (
          <div className="operations-rule-table">
            {rules.map((rule) => (
              <div className="operations-rule-row" key={rule.id}>
                <div style={{ minWidth: 0 }}>
                  <strong title={rule.label || "Peak Hours"} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rule.label || "Peak Hours"}</strong>
                  <span>{fmtHour(rule.start_hour)} - {fmtHour(rule.end_hour)}</span>
                </div>
                <em>{Number.isFinite(rule.multiplier) ? `${rule.multiplier}×` : "—"}</em>
                <div className="operations-rule-actions">
                  <HsrButton native
                    type="button"
                    className="btn"
                    onClick={() => startEdit(rule)}
                    disabled={!!activeAction || !!loadError || rule.id == null}
                  >
                    Edit Rule
                  </HsrButton>
                  <HsrButton native
                    type="button"
                    className="btn btn-danger-sm"
                    onClick={() => handleDelete(rule.id)}
                    disabled={!!activeAction || !!loadError || rule.id == null}
                    loading={activeAction === `peak-delete-${rule.id}`}
                  >
                    {activeAction === `peak-delete-${rule.id}` ? "Deleting..." : "Delete Rule"}
                  </HsrButton>
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGST();
  }, []);

  async function fetchGST() {
    setLoading(true);
    setLoadError("");
    try {
      const response = await getGST();
      const value = response.data?.gst_percent;
      if (value == null || !Number.isFinite(Number(value))) throw new Error("GST percentage unavailable");
      setGst(value);
    } catch (error) {
      setLoadError(error.userMessage || "GST setting could not load.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (loading || loadError) return;
    const value = Number(gst);
    if (!String(gst).trim() || !Number.isFinite(value) || value < 0 || value > 28) {
      showToast("Enter a GST percentage from 0 to 28.", "error");
      return;
    }
    setSaving(true);
    try {
      await saveGST(value);
      setFlash("GST setting saved");
      showToast("GST setting saved", "success");
      setTimeout(() => setFlash(""), 2500);
    } catch (error) {
      showToast(error.userMessage || "Failed to save GST", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Panel title="Tax / GST"><SkeletonBlock label="Loading GST setting" rows={2} /></Panel>;
  if (loadError) return <Panel title="Tax / GST"><RetryNotice message={loadError} detail="Reload the saved tax value before editing it." onRetry={fetchGST} /></Panel>;

  return (
    <Panel
      title="Tax / GST"
      description="Automatically add GST to every bill. Set to 0 to disable."
    >
      {flash && (
        <div className="type-sm polish-background-success-bg polish-border-1px-solid-color-mix-in-srgb-success-28-border polish-border-radius-radius-sm polish-padding-8px-12px polish-margin-bottom-12px polish-color-success-foreground polish-font-weight-weight-medium"

        >
          {flash}
        </div>
      )}

      <div className="polish-display-flex polish-gap-12px polish-align-items-flex-end" >
        <div>
          <label className="form-label" htmlFor="gst-percentage">GST Percentage</label>
          <div className="polish-display-flex polish-align-items-center polish-gap-8px" >
            <HsrInput
              id="gst-percentage"
              type="number"
              min="0"
              max="28"
              step="0.5"
              className="input-field polish-margin-0 polish-width-120px"

              value={gst}
              onChange={(e) => setGst(e.target.value)}
            />
            <span className="type-sm polish-color-text-secondary" >%</span>
          </div>
        </div>
        <HsrButton native
          className="btn btn-primary-sm polish-margin-bottom-0px"

          onClick={handleSave}
          disabled={saving}
          loading={saving}
        >
          {saving ? "Saving..." : "Save GST"}
        </HsrButton>
      </div>

      {parseFloat(gst) > 0 && (
        <div className="type-sm polish-margin-top-12px polish-padding-8px-12px polish-background-accent-bg polish-border-1px-solid-color-mix-in-srgb-accent-28-border polish-border-radius-radius-sm polish-color-accent-text"

        >
          A bill of ₹500 will have ₹{Math.round((500 * parseFloat(gst)) / 100)}{" "}
          GST added → Total ₹{500 + Math.round((500 * parseFloat(gst)) / 100)}
        </div>
      )}

      {parseFloat(gst) === 0 && (
        <div className="type-sm polish-margin-top-8px polish-color-text-muted" >
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
    <div className="operations-page polish-max-width-780px" >
      <div className="polish-display-flex polish-gap-4px polish-margin-bottom-20px" >
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
