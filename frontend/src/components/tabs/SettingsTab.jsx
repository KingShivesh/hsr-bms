import { Button as HsrButton, Icon as HsrIcon, Input as HsrInput, SkeletonGrid, Panel } from "../ui/index.js";
import { useState, useEffect } from "react";
import {
  getRates,
  saveRates,
  resetDaily,
  clearAll,
  changeAuth,
  saveMinSession,
  getMinSession,
  getBookingGrace,
  saveBookingGrace,
  changeStaffAuth,
} from "../../api/index.js";
import { useToast } from "../toastContext.js";
import TariffSettings from "../../features/sessions/TariffSettings.jsx";
import SessionControlsSettings from "../../features/sessions/SessionControlsSettings.jsx";
import RetryNotice from "../RetryNotice.jsx";

function SettingsCard({ title, description, children }) {
  return (
    <Panel as="div" className="settings-panel">
      <div className="settings-card-heading">
        <div className="settings-panel-title">{title}</div>
        {description && <div className="settings-card-description">{description}</div>}
      </div>
      {children}
    </Panel>
  );
}

function credentialErrorMessage(error, fallback) {
  const detail = error.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (typeof item?.msg === "string" ? item.msg : ""))
      .filter(Boolean);
    if (messages.length) return messages.join(". ");
  }
  return typeof error.userMessage === "string" ? error.userMessage : fallback;
}

export default function SettingsTab({ role = "admin", onOpenTables, onNavigate }) {
  const { showToast } = useToast();
  const [wr, setWr] = useState(320);
  const [pr, setPr] = useState(170);
  const [sr, setSr] = useState(270);
  const [minSession, setMinSession] = useState(0);
  const [bookingGraceMinutes, setBookingGraceMinutes] = useState(10);
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newStaffUser, setNewStaffUser] = useState("staff");
  const [newStaffPass, setNewStaffPass] = useState("");
  const [flash, setFlash] = useState("");
  const [dangerOpen, setDangerOpen] = useState(false);
  const [dangerPin, setDangerPin] = useState("");
  const [dangerConfirm, setDangerConfirm] = useState("");
  const [dangerBusy, setDangerBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState("");

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoadError("");
    try {
      const [rRes, msRes, graceRes] = await Promise.all([
        getRates(),
        getMinSession(),
        getBookingGrace(),
      ]);
      setWr(rRes.data.wr ?? 320);
      setPr(rRes.data.pr);
      setSr(rRes.data.sr);
      setMinSession(msRes.data.min_session || 0);
      setBookingGraceMinutes(graceRes.data.booking_grace_minutes || 10);
    } catch (e) {
      setLoadError(e.userMessage || "Club settings could not load.");
    } finally {
      setLoading(false);
    }
  }

  function showFlash(msg) {
    setFlash(msg);
    showToast(msg, "success");
    setTimeout(() => setFlash(""), 2500);
  }

  async function handleSaveRates() {
    setSaving("rates");
    try {
      await saveRates(
        parseInt(wr, 10) || 320,
        parseInt(pr, 10) || 170,
        parseInt(sr, 10) || 270,
      );
      showFlash("Rates saved");
    } catch {
      showToast("Table rates could not be saved. Try again.", "error");
    } finally {
      setSaving("");
    }
  }

  async function handleSaveMinSession() {
    setSaving("minimum");
    try {
      await saveMinSession(parseInt(minSession) || 0);
      showFlash("Minimum session time saved");
    } catch {
      showToast("Minimum session time could not be saved. Try again.", "error");
    } finally {
      setSaving("");
    }
  }

  async function handleSaveBookingGrace() {
    setSaving("grace");
    try {
      await saveBookingGrace(parseInt(bookingGraceMinutes) || 10);
      fetchAll();
      showFlash("Booking grace period saved");
    } catch {
      showToast("Booking grace period could not be saved. Try again.", "error");
    } finally {
      setSaving("");
    }
  }

  async function handleChangeAuth() {
    if (!newUser || !newPass) {
      showToast("Enter both username and password", "error");
      return;
    }
    if (newPass.length < 8) {
      showToast("Password must be at least 8 characters", "error");
      return;
    }
    setSaving("admin-auth");
    try {
      await changeAuth(newUser, newPass);
      showToast("Admin credentials updated. Sign in with the new password.", "success");
      localStorage.removeItem("token");
      setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      showToast(credentialErrorMessage(error, "Failed to update credentials"), "error");
    } finally {
      setSaving("");
    }
  }

  async function handleChangeStaffAuth() {
    if (!newStaffUser || !newStaffPass) {
      showToast("Enter both staff username and password", "error");
      return;
    }
    if (newStaffPass.length < 8) {
      showToast("Password must be at least 8 characters", "error");
      return;
    }
    setSaving("staff-auth");
    try {
      await changeStaffAuth(newStaffUser, newStaffPass);
      setNewStaffPass("");
      showFlash("Staff credentials updated");
    } catch (error) {
      showToast(credentialErrorMessage(error, "Failed to update staff credentials"), "error");
    } finally {
      setSaving("");
    }
  }

  async function handleResetDaily() {
    if (dangerConfirm.trim().toUpperCase() !== "RESET") {
      showToast("Type RESET before resetting daily stats", "error");
      return;
    }
    setDangerBusy("reset");
    try {
      await resetDaily(dangerPin);
      setDangerConfirm("");
      showFlash("Today's stats reset");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to reset", "error");
    } finally {
      setDangerBusy("");
    }
  }

  async function handleClearAll() {
    if (dangerConfirm.trim().toUpperCase() !== "CLEAR") {
      showToast("Type CLEAR before clearing all data", "error");
      return;
    }
    setDangerBusy("clear");
    try {
      await clearAll(dangerPin);
      showToast("All data cleared", "success");
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to clear data", "error");
    } finally {
      setDangerBusy("");
    }
  }

  if (loading) return <SkeletonGrid count={4} label="Fetching club settings" />;
  if (loadError) return <RetryNotice message={loadError} detail="Saved settings are unavailable. Retry before making changes." onRetry={() => { setLoading(true); fetchAll(); }} />;

  return (
    <div className="settings-page-shell">
      {flash && <div className="settings-flash">{flash}</div>}

      <SettingsCard
        title="Table Operations"
        description="Open the table floor when a session needs to be started or reviewed."
      >
        <div className="settings-action-row">
          <div>
            <strong>Session controls live on the table floor</strong>
            <span>Start, reserve, pause, close and review active tables from one focused screen.</span>
          </div>
          <HsrButton native
            className="btn btn-primary-sm"
            type="button"
            onClick={onOpenTables}
          >
            <HsrIcon className="ti ti-billiard" aria-hidden="true" />
            Open table floor
          </HsrButton>
        </div>
      </SettingsCard>

      {/* Rates */}
      <SettingsCard
        title="HSR Table Rates"
        description="Set the hourly billing rate for each HSR table group."
      >
        <div className="settings-form-grid">
          <div>
            <label className="form-label" htmlFor="settings-wiraka-rate">Wiraka Rate T1/T2 (₹/hour)</label>
            <HsrInput
              id="settings-wiraka-rate"
              type="number"
              className="input-field"
              value={wr}
              onChange={(e) => setWr(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="settings-pool-rate">Pool Rate T5 (₹/hour)</label>
            <HsrInput
              id="settings-pool-rate"
              type="number"
              className="input-field"
              value={pr}
              onChange={(e) => setPr(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="settings-english-rate">English Rate T3/T4 (₹/hour)</label>
            <HsrInput
              id="settings-english-rate"
              type="number"
              className="input-field"
              value={sr}
              onChange={(e) => setSr(e.target.value)}
            />
          </div>
        </div>
        <HsrButton native className="btn btn-primary-sm" onClick={handleSaveRates} loading={saving === "rates"} disabled={!!saving}>
          <HsrIcon className="ti ti-device-floppy" aria-hidden="true" />
          Save Table Rates
        </HsrButton>
      </SettingsCard>

      {role === "admin" && <TariffSettings />}
      {role === "admin" && <SessionControlsSettings />}

      {/* Min session */}
      <SettingsCard
        title="Minimum Session Time"
        description="Bill at least this many minutes on checkout (0 = disabled)"
      >
        <div className="settings-inline-row">
          <div className="settings-inline-field">
            <label className="form-label" htmlFor="settings-minimum-minutes">Minimum minutes</label>
            <HsrInput
              id="settings-minimum-minutes"
              type="number"
              min="0"
              className="input-field"
              value={minSession}
              onChange={(e) => setMinSession(e.target.value)}
            />
          </div>
          <HsrButton native
            className="btn btn-primary-sm"
            onClick={handleSaveMinSession}
            loading={saving === "minimum"}
            disabled={!!saving}
          >
            <HsrIcon className="ti ti-device-floppy" aria-hidden="true" />
            Save Minimum Session
          </HsrButton>
        </div>
        {minSession > 0 && (
          <div className="settings-inline-note info">
            Short sessions will close normally and bill as {minSession} minutes
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="Booking Grace Period"
        description="Auto-release no-show bookings after the grace period"
      >
        <div className="settings-inline-row">
          <div className="settings-inline-field">
            <label className="form-label" htmlFor="settings-grace-minutes">Grace minutes after booking time</label>
            <HsrInput
              id="settings-grace-minutes"
              type="number"
              min="1"
              max="120"
              className="input-field"
              value={bookingGraceMinutes}
              onChange={(e) => setBookingGraceMinutes(e.target.value)}
            />
          </div>
          <HsrButton native
            className="btn btn-primary-sm"
            onClick={handleSaveBookingGrace}
            loading={saving === "grace"}
            disabled={!!saving}
          >
            <HsrIcon className="ti ti-device-floppy" aria-hidden="true" />
            Save Grace Period
          </HsrButton>
        </div>
        <div className="settings-inline-note muted">
          Bookings become missed after {bookingGraceMinutes || 10} minutes if no matching table session has started.
        </div>
      </SettingsCard>

      {/* Menu */}
      <SettingsCard
        title="Food Menu"
        description="Menu stock and availability are managed from Inventory & Stocks."
      >
        <div className="settings-action-row">
          <div>
            <strong>Use the dedicated inventory workspace</strong>
            <span>Edit menu items, prices, categories, bulk stock state and table maintenance from one operational screen.</span>
          </div>
          <HsrButton native
            className="btn btn-primary-sm"
            type="button"
            onClick={() => onNavigate?.("inventory")}
          >
            <HsrIcon className="ti ti-arrow-right" aria-hidden="true" />
            Manage stock and availability in Inventory & Stocks
          </HsrButton>
        </div>
      </SettingsCard>

      {role === "admin" && (
        <>
          {/* Auth */}
          <SettingsCard
            title="Admin Credentials"
            description="Update the admin login username and password"
          >
            <div className="settings-credentials-grid">
              <div>
                <label className="form-label" htmlFor="settings-admin-username">New Admin Username</label>
                <HsrInput
                  id="settings-admin-username"
                  type="text"
                  className="input-field"
                  placeholder="Enter new username"
                  value={newUser}
                  onChange={(e) => setNewUser(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="settings-admin-password">New Admin Password</label>
                <HsrInput
                  id="settings-admin-password"
                  type="password"
                  className="input-field"
                  placeholder="Min 8 characters"
                  minLength={8}
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                />
              </div>
            </div>
            <HsrButton native
              className="btn btn-warning-sm"
              onClick={handleChangeAuth}
              loading={saving === "admin-auth"}
              disabled={!!saving}
              data-testid="change-auth-button"
            >
              <HsrIcon className="ti ti-key" aria-hidden="true" />
              Update admin credentials
            </HsrButton>
          </SettingsCard>

          <SettingsCard
            title="Staff Credentials"
            description="Staff can run daily operations but cannot see Reports or sensitive settings actions"
          >
            <div className="settings-credentials-grid">
              <div>
                <label className="form-label" htmlFor="settings-staff-username">Staff Username</label>
                <HsrInput
                  id="settings-staff-username"
                  type="text"
                  className="input-field"
                  value={newStaffUser}
                  onChange={(e) => setNewStaffUser(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="settings-staff-password">Staff Password</label>
                <HsrInput
                  id="settings-staff-password"
                  type="password"
                  className="input-field"
                  placeholder="Min 8 characters"
                  minLength={8}
                  value={newStaffPass}
                  onChange={(e) => setNewStaffPass(e.target.value)}
                />
              </div>
            </div>
            <HsrButton native
              className="btn btn-primary-sm"
              onClick={handleChangeStaffAuth}
              loading={saving === "staff-auth"}
              disabled={!!saving}
              data-testid="change-staff-auth-button"
            >
              <HsrIcon className="ti ti-users" aria-hidden="true" />
              Update staff credentials
            </HsrButton>
          </SettingsCard>

          <SettingsCard
            title="Danger Zone"
            description="Protected reset tools for setup and emergency recovery only"
          >
            <div className="settings-danger-zone">
              <HsrButton native
                className="btn btn-danger-sm"
                type="button"
                onClick={() => setDangerOpen((open) => !open)}
              >
                <HsrIcon className="ti ti-shield-lock" aria-hidden="true" />
                {dangerOpen ? "Hide protected actions" : "Show protected actions"}
              </HsrButton>
              {dangerOpen && (
                <div className="settings-danger-panel">
                  <div className="settings-inline-note muted">
                    Use this only before handover or when recovering demo/test data. Type RESET for daily stats or CLEAR for all data.
                  </div>
                  <div className="settings-credentials-grid">
                    <div>
                      <label className="form-label" htmlFor="settings-manager-pin">Manager PIN</label>
                      <HsrInput
                        id="settings-manager-pin"
                        type="password"
                        className="input-field"
                        placeholder="Required if manager PIN is enabled"
                        value={dangerPin}
                        onChange={(e) => setDangerPin(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="settings-confirmation-word">Confirmation word</label>
                      <HsrInput
                        id="settings-confirmation-word"
                        type="text"
                        className="input-field"
                        placeholder="RESET or CLEAR"
                        value={dangerConfirm}
                        onChange={(e) => setDangerConfirm(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="settings-data-actions">
                    <HsrButton native
                      className="btn btn-warning-sm"
                      onClick={handleResetDaily}
                      disabled={dangerBusy === "reset"}
                      data-testid="reset-daily-button"
                    >
                      <HsrIcon className="ti ti-refresh" aria-hidden="true" />
                      {dangerBusy === "reset" ? "Resetting..." : "Reset daily stats"}
                    </HsrButton>
                    <HsrButton native
                      className="btn btn-danger-sm"
                      onClick={handleClearAll}
                      disabled={dangerBusy === "clear"}
                      data-testid="clear-all-button"
                    >
                      <HsrIcon className="ti ti-alert-triangle" aria-hidden="true" />
                      {dangerBusy === "clear" ? "Clearing..." : "Clear all data"}
                    </HsrButton>
                  </div>
                </div>
              )}
            </div>
          </SettingsCard>
        </>
      )}
    </div>
  );
}
