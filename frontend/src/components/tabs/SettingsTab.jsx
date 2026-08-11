import { useState, useEffect } from "react";
import {
  getRates,
  saveRates,
  getMenu,
  addMenuItem,
  updateMenuItem,
  deleteMenuItem,
  resetDaily,
  clearAll,
  changeAuth,
  setItemAvailability,
  saveMinSession,
  getMinSession,
  getBookingGrace,
  saveBookingGrace,
  changeStaffAuth,
} from "../../api/index.js";

const CATEGORIES = ["Drinks", "Snacks", "Meals", "Cigarettes"];

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

export default function SettingsTab({ role = "admin", onOpenTables }) {
  const [wr, setWr] = useState(320);
  const [pr, setPr] = useState(170);
  const [sr, setSr] = useState(270);
  const [minSession, setMinSession] = useState(0);
  const [bookingGraceMinutes, setBookingGraceMinutes] = useState(10);
  const [menu, setMenu] = useState({});
  const [newItem, setNewItem] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCat, setNewCat] = useState("Snacks");
  const [editName, setEditName] = useState({});
  const [editPrice, setEditPrice] = useState({});
  const [editCat, setEditCat] = useState({});
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newStaffUser, setNewStaffUser] = useState("staff");
  const [newStaffPass, setNewStaffPass] = useState("");
  const [flash, setFlash] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    try {
      const [rRes, mRes, msRes, graceRes] = await Promise.all([
        getRates(),
        getMenu(),
        getMinSession(),
        getBookingGrace(),
      ]);
      setWr(rRes.data.wr ?? 320);
      setPr(rRes.data.pr);
      setSr(rRes.data.sr);
      setMinSession(msRes.data.min_session || 0);
      setBookingGraceMinutes(graceRes.data.booking_grace_minutes || 10);
      const raw = mRes.data;
      setMenu(raw);
      const n = {},
        p = {},
        c = {};
      Object.entries(raw).forEach(([k, v]) => {
        n[k] = k;
        p[k] = typeof v === "object" ? v.price : v;
        c[k] = typeof v === "object" ? v.category || "Snacks" : "Snacks";
      });
      setEditName(n);
      setEditPrice(p);
      setEditCat(c);
    } catch (e) {
      console.error(e);
    }
  }

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 2500);
  }

  function getItemCat(v) {
    return typeof v === "object" ? v.category || "Snacks" : "Snacks";
  }
  function getItemAvail(v) {
    return typeof v === "object" ? v.available !== false : true;
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
      alert("Failed to save rates");
    }
  }

  async function handleSaveMinSession() {
    try {
      await saveMinSession(parseInt(minSession) || 0);
      showFlash("Minimum session time saved");
    } catch {
      alert("Failed to save");
    }
  }

  async function handleSaveBookingGrace() {
    try {
      await saveBookingGrace(parseInt(bookingGraceMinutes) || 10);
      fetchAll();
      showFlash("Booking grace period saved");
    } catch {
      alert("Failed to save booking grace period");
    }
  }

  async function handleAddItem() {
    if (!newItem || !newPrice) {
      alert("Enter item name and price");
      return;
    }
    try {
      await addMenuItem(newItem.trim(), parseInt(newPrice), newCat);
      setNewItem("");
      setNewPrice("");
      setNewCat("Snacks");
      fetchAll();
      showFlash("Item added");
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to add item");
    }
  }

  async function handleUpdateItem(oldName) {
    try {
      await updateMenuItem(
        oldName,
        editName[oldName],
        parseInt(editPrice[oldName]),
        editCat[oldName],
      );
      fetchAll();
      showFlash("Item updated");
    } catch {
      alert("Failed to update item");
    }
  }

  async function handleDeleteItem(name) {
    if (!confirm(`Delete ${name}?`)) return;
    try {
      await deleteMenuItem(name);
      fetchAll();
    } catch {
      alert("Failed to delete item");
    }
  }

  async function handleToggleAvail(name, current) {
    try {
      await setItemAvailability(name, !current);
      fetchAll();
    } catch {
      alert("Failed to update availability");
    }
  }

  async function handleChangeAuth() {
    if (!newUser || !newPass) {
      alert("Enter both username and password");
      return;
    }
    if (newPass.length < 6) {
      alert("Password must be at least 6 characters");
      return;
    }
    try {
      await changeAuth(newUser, newPass);
      alert("Credentials updated. Please login again.");
      localStorage.removeItem("token");
      window.location.reload();
    } catch {
      alert("Failed to update credentials");
    }
  }

  async function handleChangeStaffAuth() {
    if (!newStaffUser || !newStaffPass) {
      alert("Enter both staff username and password");
      return;
    }
    if (newStaffPass.length < 6) {
      alert("Password must be at least 6 characters");
      return;
    }
    try {
      await changeStaffAuth(newStaffUser, newStaffPass);
      setNewStaffPass("");
      showFlash("Staff credentials updated");
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to update staff credentials");
    }
  }

  async function handleResetDaily() {
    if (!confirm("Reset today's statistics?")) return;
    try {
      await resetDaily("");
      showFlash("Today's stats reset");
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to reset");
    }
  }

  async function handleClearAll() {
    if (!confirm("Clear ALL data? This cannot be undone!")) return;
    try {
      await clearAll("");
      alert("All data cleared");
      window.location.reload();
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to clear data");
    }
  }

  const menuEntries = Object.entries(menu);
  const filteredMenu =
    activeCategory === "All"
      ? menuEntries
      : menuEntries.filter(([, v]) => getItemCat(v) === activeCategory);

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
          Save rates
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
            Save
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
            Save
          </button>
        </div>
        <div className="settings-inline-note muted">
          Bookings become missed after {bookingGraceMinutes || 10} minutes if no matching table session has started.
        </div>
      </SettingsCard>

      {/* Menu */}
      <SettingsCard
        title="Food Menu"
        description="Manage items, categories and availability"
      >
        {/* Category filter */}
        <div className="settings-chip-row">
          {["All", ...CATEGORIES].map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`settings-chip ${activeCategory === cat ? "active" : ""}`}
            >
              {cat}
            </button>
          ))}
        </div>

        {filteredMenu.map(([k, v]) => {
          const avail = getItemAvail(v);
          return (
            <div key={k} className={`settings-menu-row ${avail ? "" : "is-disabled"}`}>
              <input
                className="input-field"
                data-size="name"
                value={editName[k] || ""}
                onChange={(e) =>
                  setEditName((p) => ({ ...p, [k]: e.target.value }))
                }
              />
              <input
                type="number"
                className="input-field"
                data-size="price"
                value={editPrice[k] || ""}
                onChange={(e) =>
                  setEditPrice((p) => ({ ...p, [k]: e.target.value }))
                }
              />
              <select
                className="input-field"
                data-size="category"
                value={editCat[k] || "Snacks"}
                onChange={(e) =>
                  setEditCat((p) => ({ ...p, [k]: e.target.value }))
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <button
                className="btn btn-primary-sm"
                onClick={() => handleUpdateItem(k)}
              >
                <i className="ti ti-device-floppy" aria-hidden="true" />
                Save
              </button>
              <button
                onClick={() => handleToggleAvail(k, avail)}
                className={`btn ${avail ? "btn-success-sm" : "btn-danger-sm"}`}
              >
                <i className={avail ? "ti ti-check" : "ti ti-x"} aria-hidden="true" />
                {avail ? "In stock" : "Out"}
              </button>
              <button
                className="btn btn-danger-sm"
                onClick={() => handleDeleteItem(k)}
              >
                <i className="ti ti-trash" aria-hidden="true" />
                Del
              </button>
            </div>
          );
        })}

        {/* Add new item */}
        <div className="settings-add-menu-row">
          <input
            className="input-field"
            data-size="name"
            placeholder="Item name"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
          />
          <input
            type="number"
            className="input-field"
            data-size="price"
            placeholder="₹ Price"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
          />
          <select
            className="input-field"
            data-size="category"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button
            className="btn btn-success-sm"
            onClick={handleAddItem}
            data-testid="add-menu-item-button"
          >
            <i className="ti ti-plus" aria-hidden="true" />
            Add
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

          {/* Data */}
          <SettingsCard
            title="Data Management"
            description="Reset or clear stored data — these actions cannot be undone"
          >
            <div className="settings-data-actions">
              <button
                className="btn btn-warning-sm"
                onClick={handleResetDaily}
                data-testid="reset-daily-button"
              >
                <i className="ti ti-refresh" aria-hidden="true" />
                Reset daily stats
              </button>
              <button
                className="btn btn-danger-sm"
                onClick={handleClearAll}
                data-testid="clear-all-button"
              >
                <i className="ti ti-alert-triangle" aria-hidden="true" />
                Clear all data
              </button>
            </div>
          </SettingsCard>
        </>
      )}
    </div>
  );
}
