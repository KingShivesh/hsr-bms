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

function SettingsCard({ title, description, children }) {
  return (
    <div className="settings-panel">
      <div className="settings-card-heading">
        <div className="settings-panel-title">{title}</div>
        {description && <div className="settings-card-description">{description}</div>}
      </div>
      {children}
    </div>
  );
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

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
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
      console.error(e);
    }
  }

  function showFlash(msg) {
    setFlash(msg);
    showToast(msg, "success");
    setTimeout(() => setFlash(""), 2500);
  }

  async function handleSaveRates() {
    try {
      await saveRates(
        parseInt(wr, 10) || 320,
        parseInt(pr, 10) || 170,
        parseInt(sr, 10) || 270,
      );
      showFlash("Rates saved");
    } catch {
      showToast("Failed to save rates", "error");
    }
  }

  async function handleSaveMinSession() {
    try {
      await saveMinSession(parseInt(minSession) || 0);
      showFlash("Minimum session time saved");
    } catch {
      showToast("Failed to save", "error");
    }
  }

  async function handleSaveBookingGrace() {
    try {
      await saveBookingGrace(parseInt(bookingGraceMinutes) || 10);
      fetchAll();
      showFlash("Booking grace period saved");
    } catch {
      showToast("Failed to save booking grace period", "error");
    }
  }

  async function handleChangeAuth() {
    if (!newUser || !newPass) {
      showToast("Enter both username and password", "error");
      return;
    }
    if (newPass.length < 6) {
      showToast("Password must be at least 6 characters", "error");
      return;
    }
    try {
      await changeAuth(newUser, newPass);
      showToast("Credentials updated. Please login again.", "success");
      localStorage.removeItem("token");
      setTimeout(() => window.location.reload(), 700);
    } catch {
      showToast("Failed to update credentials", "error");
    }
  }

  async function handleChangeStaffAuth() {
    if (!newStaffUser || !newStaffPass) {
      showToast("Enter both staff username and password", "error");
      return;
    }
    if (newStaffPass.length < 6) {
      showToast("Password must be at least 6 characters", "error");
      return;
    }
    try {
      await changeStaffAuth(newStaffUser, newStaffPass);
      setNewStaffPass("");
      showFlash("Staff credentials updated");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to update staff credentials", "error");
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
          <button
            className="btn btn-primary-sm"
            type="button"
            onClick={onOpenTables}
          >
            <i className="ti ti-billiard" aria-hidden="true" />
            Open table floor
          </button>
        </div>
      </SettingsCard>

      {/* Rates */}
      <SettingsCard
        title="HSR Table Rates"
        description="Set the hourly billing rate for each HSR table group."
      >
        <div className="settings-form-grid">
          <div>
            <label className="form-label">Wiraka Rate T1/T2 (₹/hour)</label>
            <input
              type="number"
              className="input-field"
              value={wr}
              onChange={(e) => setWr(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">Pool Rate T5 (₹/hour)</label>
            <input
              type="number"
              className="input-field"
              value={pr}
              onChange={(e) => setPr(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">English Rate T3/T4 (₹/hour)</label>
            <input
              type="number"
              className="input-field"
              value={sr}
              onChange={(e) => setSr(e.target.value)}
            />
          </div>
        </div>
        <button className="btn btn-primary-sm" onClick={handleSaveRates}>
          <i className="ti ti-device-floppy" aria-hidden="true" />
          Save Table Rates
        </button>
      </SettingsCard>

      {/* Min session */}
      <SettingsCard
        title="Minimum Session Time"
        description="Bill at least this many minutes on checkout (0 = disabled)"
      >
        <div className="settings-inline-row">
          <div className="settings-inline-field">
            <label className="form-label">Minimum minutes</label>
            <input
              type="number"
              min="0"
              className="input-field"
              value={minSession}
              onChange={(e) => setMinSession(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary-sm"
            onClick={handleSaveMinSession}
          >
            <i className="ti ti-device-floppy" aria-hidden="true" />
            Save Minimum Session
          </button>
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
            <label className="form-label">Grace minutes after booking time</label>
            <input
              type="number"
              min="1"
              max="120"
              className="input-field"
              value={bookingGraceMinutes}
              onChange={(e) => setBookingGraceMinutes(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary-sm"
            onClick={handleSaveBookingGrace}
          >
            <i className="ti ti-device-floppy" aria-hidden="true" />
            Save Grace Period
          </button>
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
          <button
            className="btn btn-primary-sm"
            type="button"
            onClick={() => onNavigate?.("inventory")}
          >
            <i className="ti ti-arrow-right" aria-hidden="true" />
            Manage stock and availability in Inventory & Stocks
          </button>
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
                <label className="form-label">New Admin Username</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Enter new username"
                  value={newUser}
                  onChange={(e) => setNewUser(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">New Admin Password</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="Min 6 characters"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                />
              </div>
            </div>
            <button
              className="btn btn-warning-sm"
              onClick={handleChangeAuth}
              data-testid="change-auth-button"
            >
              <i className="ti ti-key" aria-hidden="true" />
              Update admin credentials
            </button>
          </SettingsCard>

          <SettingsCard
            title="Staff Credentials"
            description="Staff can run daily operations but cannot see Reports or sensitive settings actions"
          >
            <div className="settings-credentials-grid">
              <div>
                <label className="form-label">Staff Username</label>
                <input
                  type="text"
                  className="input-field"
                  value={newStaffUser}
                  onChange={(e) => setNewStaffUser(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">Staff Password</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="Min 6 characters"
                  value={newStaffPass}
                  onChange={(e) => setNewStaffPass(e.target.value)}
                />
              </div>
            </div>
            <button
              className="btn btn-primary-sm"
              onClick={handleChangeStaffAuth}
              data-testid="change-staff-auth-button"
            >
              <i className="ti ti-users" aria-hidden="true" />
              Update staff credentials
            </button>
          </SettingsCard>

          <SettingsCard
            title="Danger Zone"
            description="Protected reset tools for setup and emergency recovery only"
          >
            <div className="settings-danger-zone">
              <button
                className="btn btn-danger-sm"
                type="button"
                onClick={() => setDangerOpen((open) => !open)}
              >
                <i className="ti ti-shield-lock" aria-hidden="true" />
                {dangerOpen ? "Hide protected actions" : "Show protected actions"}
              </button>
              {dangerOpen && (
                <div className="settings-danger-panel">
                  <div className="settings-inline-note muted">
                    Use this only before handover or when recovering demo/test data. Type RESET for daily stats or CLEAR for all data.
                  </div>
                  <div className="settings-credentials-grid">
                    <div>
                      <label className="form-label">Manager PIN</label>
                      <input
                        type="password"
                        className="input-field"
                        placeholder="Required if manager PIN is enabled"
                        value={dangerPin}
                        onChange={(e) => setDangerPin(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="form-label">Confirmation word</label>
                      <input
                        type="text"
                        className="input-field"
                        placeholder="RESET or CLEAR"
                        value={dangerConfirm}
                        onChange={(e) => setDangerConfirm(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="settings-data-actions">
                    <button
                      className="btn btn-warning-sm"
                      onClick={handleResetDaily}
                      disabled={dangerBusy === "reset"}
                      data-testid="reset-daily-button"
                    >
                      <i className="ti ti-refresh" aria-hidden="true" />
                      {dangerBusy === "reset" ? "Resetting..." : "Reset daily stats"}
                    </button>
                    <button
                      className="btn btn-danger-sm"
                      onClick={handleClearAll}
                      disabled={dangerBusy === "clear"}
                      data-testid="clear-all-button"
                    >
                      <i className="ti ti-alert-triangle" aria-hidden="true" />
                      {dangerBusy === "clear" ? "Clearing..." : "Clear all data"}
                    </button>
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
