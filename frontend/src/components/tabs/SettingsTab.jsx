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
} from "../../api/index.js";
import OperationsTab from "./OperationsTab.jsx";

const CATEGORIES = ["Drinks", "Snacks", "Meals", "Cigarettes"];

function SettingsCard({ title, description, children }) {
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

export default function SettingsTab() {
  const [section, setSection] = useState("general");
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
    <div style={{ maxWidth: "780px" }}>
      <div style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
        {[
          { id: "general", label: "General" },
          { id: "operations", label: "Operations" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSection(tab.id)}
            style={{
              fontSize: "13px",
              padding: "6px 18px",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: section === tab.id ? 600 : 400,
              background: section === tab.id ? "#111" : "#fff",
              color: section === tab.id ? "#fff" : "#888",
              border:
                section === tab.id ? "1px solid #111" : "1px solid #e5e5e5",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {section === "operations" ? (
        <OperationsTab />
      ) : (
        <>
      {flash && (
        <div
          style={{
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "8px",
            padding: "10px 16px",
            marginBottom: "16px",
            fontSize: "13px",
            color: "#16a34a",
            fontWeight: 500,
          }}
        >
          {flash}
        </div>
      )}

      {/* Rates */}
      <SettingsCard
        title="HSR Table Rates"
        description="Set the hourly billing rate for each HSR table group."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "16px",
            marginBottom: "16px",
          }}
        >
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
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label className="form-label">Minimum minutes</label>
            <input
              type="number"
              min="0"
              className="input-field"
              style={{ marginBottom: 0 }}
              value={minSession}
              onChange={(e) => setMinSession(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary-sm"
            style={{ marginBottom: "1px" }}
            onClick={handleSaveMinSession}
          >
            <i className="ti ti-device-floppy" aria-hidden="true" />
            Save
          </button>
        </div>
        {minSession > 0 && (
          <div style={{ fontSize: "12px", color: "#2563eb", marginTop: "8px" }}>
            Short sessions will close normally and bill as {minSession} minutes
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="Booking Grace Period"
        description="Auto-release no-show bookings after the grace period"
      >
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label className="form-label">Grace minutes after booking time</label>
            <input
              type="number"
              min="1"
              max="120"
              className="input-field"
              style={{ marginBottom: 0 }}
              value={bookingGraceMinutes}
              onChange={(e) => setBookingGraceMinutes(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary-sm"
            style={{ marginBottom: "1px" }}
            onClick={handleSaveBookingGrace}
          >
            <i className="ti ti-device-floppy" aria-hidden="true" />
            Save
          </button>
        </div>
        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "8px" }}>
          Bookings become missed after {bookingGraceMinutes || 10} minutes if no matching table session has started.
        </div>
      </SettingsCard>

      {/* Menu */}
      <SettingsCard
        title="Food Menu"
        description="Manage items, categories and availability"
      >
        {/* Category filter */}
        <div
          style={{
            display: "flex",
            gap: "6px",
            marginBottom: "14px",
            flexWrap: "wrap",
          }}
        >
          {["All", ...CATEGORIES].map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                fontSize: "12px",
                padding: "4px 14px",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: activeCategory === cat ? 600 : 400,
                background: activeCategory === cat ? "#111" : "#fff",
                color: activeCategory === cat ? "#fff" : "#888",
                border:
                  activeCategory === cat
                    ? "1px solid #111"
                    : "1px solid #e5e5e5",
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {filteredMenu.map(([k, v]) => {
          const avail = getItemAvail(v);
          return (
            <div
              key={k}
              style={{
                display: "flex",
                gap: "8px",
                marginBottom: "8px",
                alignItems: "center",
                opacity: avail ? 1 : 0.5,
              }}
            >
              <input
                className="input-field"
                style={{ flex: 2, margin: 0 }}
                value={editName[k] || ""}
                onChange={(e) =>
                  setEditName((p) => ({ ...p, [k]: e.target.value }))
                }
              />
              <input
                type="number"
                className="input-field"
                style={{ flex: 1, margin: 0 }}
                value={editPrice[k] || ""}
                onChange={(e) =>
                  setEditPrice((p) => ({ ...p, [k]: e.target.value }))
                }
              />
              <select
                className="input-field"
                style={{ flex: 1, margin: 0 }}
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
                style={{ whiteSpace: "nowrap" }}
                onClick={() => handleUpdateItem(k)}
              >
                <i className="ti ti-device-floppy" aria-hidden="true" />
                Save
              </button>
              <button
                onClick={() => handleToggleAvail(k, avail)}
                className={`btn ${avail ? "btn-success-sm" : "btn-danger-sm"}`}
                style={{ whiteSpace: "nowrap" }}
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
        <div
          style={{
            display: "flex",
            gap: "8px",
            paddingTop: "12px",
            borderTop: "1px solid #f5f5f5",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            className="input-field"
            style={{ flex: 2, margin: 0, minWidth: "100px" }}
            placeholder="Item name"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
          />
          <input
            type="number"
            className="input-field"
            style={{ flex: 1, margin: 0, minWidth: "70px" }}
            placeholder="₹ Price"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
          />
          <select
            className="input-field"
            style={{ flex: 1, margin: 0, minWidth: "90px" }}
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

      {/* Auth */}
      <SettingsCard
        title="Change Credentials"
        description="Update the owner login username and password"
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            marginBottom: "16px",
          }}
        >
          <div>
            <label className="form-label">New Username</label>
            <input
              type="text"
              className="input-field"
              placeholder="Enter new username"
              value={newUser}
              onChange={(e) => setNewUser(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">New Password</label>
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
          Update credentials
        </button>
      </SettingsCard>

      {/* Data */}
      <SettingsCard
        title="Data Management"
        description="Reset or clear stored data — these actions cannot be undone"
      >
        <div style={{ display: "flex", gap: "10px" }}>
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
