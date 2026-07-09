import { useState, useEffect } from "react";
import {
  getMembers,
  addMember,
  upgradeMember,
  deleteMember,
  getMemberDuplicates,
  mergeMembers,
} from "../../api/index.js";

function isFullName(name) {
  return name.trim().split(/\s+/).filter(Boolean).length >= 2;
}

export default function MembersTab() {
  const [members, setMembers] = useState([]);
  const [duplicates, setDuplicates] = useState([]);

  useEffect(() => {
    fetchMembers();
  }, []);

  async function fetchMembers() {
    try {
      const [res, dupRes] = await Promise.all([
        getMembers(),
        getMemberDuplicates(),
      ]);
      setMembers(res.data);
      setDuplicates(dupRes.data);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleAdd() {
    const name = prompt("Enter member name:");
    if (!name) return;
    if (!isFullName(name)) {
      alert("Please enter the member's full name (first and last name).");
      return;
    }
    try {
      await addMember(name.trim());
      fetchMembers();
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to add member");
    }
  }

  async function handleUpgrade(customerId) {
    try {
      await upgradeMember(customerId);
      fetchMembers();
    } catch {
      alert("Failed to upgrade member");
    }
  }

  async function handleDelete(customerId) {
    if (!confirm("Delete this member?")) return;
    try {
      await deleteMember(customerId);
      fetchMembers();
    } catch {
      alert("Failed to delete member");
    }
  }

  async function handleMerge(primaryId, duplicateId, primaryName, duplicateName) {
    if (!confirm(`Merge "${duplicateName}" into "${primaryName}"? This combines visits, spend, and transaction history.`)) return;
    try {
      await mergeMembers(primaryId, duplicateId);
      fetchMembers();
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to merge members");
    }
  }

  const totalMembers = members.length;
  const premiumCount = members.filter((m) => m.typ === "Premium").length;
  const totalRevenue = members.reduce((a, m) => a + m.spt, 0);
  const totalVisits = members.reduce((a, m) => a + m.vis, 0);

  return (
    <div>
      {/* Stats bar */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        {[
          { label: "Total Members", value: totalMembers, color: "#111" },
          { label: "Premium Members", value: premiumCount, color: "#d97706" },
          {
            label: "Total Revenue",
            value: `₹${totalRevenue.toLocaleString("en-IN")}`,
            color: "#16a34a",
          },
          { label: "Total Visits", value: totalVisits, color: "#2563eb" },
        ].map((s, i) => (
          <div
            key={i}
            style={{
              background: "#fff",
              border: "1px solid #f0f0f0",
              borderRadius: "8px",
              padding: "14px 16px",
              borderTop: `2px solid ${s.color}`,
            }}
          >
            <div
              style={{
                fontSize: "11px",
                color: "#bbb",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: "6px",
              }}
            >
              {s.label}
            </div>
            <div style={{ fontSize: "22px", fontWeight: 600, color: s.color }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      {duplicates.length > 0 && (
        <div className="member-merge-panel">
          <div className="member-merge-head">
            <div>
              <div className="section-heading" style={{ marginBottom: 2 }}>
                Smart member merge
              </div>
              <div className="empty-state-detail">
                High-confidence duplicate names found. Pick the profile to keep.
              </div>
            </div>
            <i className="ti ti-users-group" aria-hidden="true" />
          </div>
          <div className="member-merge-list">
            {duplicates.map((group) =>
              group.matches.map((match) => (
                <div className="member-merge-row" key={`${group.primary.id}-${match.id}`}>
                  <div>
                    <strong>{group.primary.name}</strong>
                    <span>{group.primary.id} · ₹{group.primary.spent.toLocaleString("en-IN")}</span>
                  </div>
                  <i className="ti ti-arrows-join" aria-hidden="true" />
                  <div>
                    <strong>{match.name}</strong>
                    <span>{match.id} · {match.score}% match</span>
                  </div>
                  <button
                    type="button"
                    className="member-action-btn is-upgrade"
                    onClick={() =>
                      handleMerge(group.primary.id, match.id, group.primary.name, match.name)
                    }
                  >
                    Merge
                  </button>
                </div>
              )),
            )}
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#111" }}>
          All Members
        </div>
        <button
          className="member-add-btn"
          onClick={handleAdd}
          data-testid="add-member-button"
        >
          <i className="ti ti-user-plus" aria-hidden="true" />
          <span>Add member</span>
        </button>
      </div>

      {members.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            color: "#bbb",
            padding: "40px 0",
            fontSize: "13px",
          }}
        >
          No members yet. Add your first member above.
        </div>
      ) : (
        members.map((m, i) => (
          <div
            key={i}
            className={`member-card ${m.typ === "Premium" ? "premium" : ""}`}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              <div>
                <div
                  style={{ fontWeight: 600, color: "#111", fontSize: "14px" }}
                >
                  {m.nm}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginTop: "3px",
                  }}
                >
                  <span style={{ fontSize: "11px", color: "#bbb" }}>
                    {m.id || "—"}
                  </span>
                  <span
                    className={`member-badge ${m.typ === "Premium" ? "badge-premium" : "badge-regular"}`}
                  >
                    {m.typ.toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="member-actions">
                <button
                  className={`member-action-btn ${m.typ === "Premium" ? "is-downgrade" : "is-upgrade"}`}
                  onClick={() => handleUpgrade(m.id)}
                >
                  <i
                    className={`ti ${m.typ === "Premium" ? "ti-arrow-down" : "ti-arrow-up"}`}
                    aria-hidden="true"
                  />
                  {m.typ === "Premium" ? "Downgrade" : "Upgrade"}
                </button>
                <button
                  className="member-action-btn is-delete"
                  onClick={() => handleDelete(m.id)}
                >
                  <i className="ti ti-trash" aria-hidden="true" />
                  Delete
                </button>
              </div>
            </div>
            <div className="member-stats">
              <div className="member-stat">
                <div className="member-stat-value">{m.vis}</div>
                <div className="member-stat-label">Visits</div>
              </div>
              <div className="member-stat">
                <div className="member-stat-value">
                  ₹{m.spt.toLocaleString("en-IN")}
                </div>
                <div className="member-stat-label">Spent</div>
              </div>
              <div className="member-stat">
                <div className="member-stat-value" style={{ fontSize: "14px" }}>
                  {m.lst}
                </div>
                <div className="member-stat-label">Last Visit</div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
