import { useState, useEffect } from "react";
import {
  getMembers,
  addMember,
  upgradeMember,
  deleteMember,
  getMemberDuplicates,
  mergeMembers,
} from "../../api/index.js";
import { useToast } from "../toastContext.js";

function isFullName(name) {
  return name.trim().length > 0;
}

export default function MembersTab() {
  const { showToast } = useToast();
  const [members, setMembers] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [activeAction, setActiveAction] = useState("");

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
      showToast("Please enter the member name.", "error");
      return;
    }
    setActiveAction("member-add");
    try {
      await addMember(name.trim());
      await fetchMembers();
      showToast("Member added", "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to add member", "error");
    } finally {
      setActiveAction("");
    }
  }

  async function handleUpgrade(customerId) {
    setActiveAction(`member-upgrade-${customerId}`);
    try {
      await upgradeMember(customerId);
      await fetchMembers();
      showToast("Member status updated", "success");
    } catch {
      showToast("Failed to upgrade member", "error");
    } finally {
      setActiveAction("");
    }
  }

  async function handleDelete(customerId) {
    if (!confirm("Delete this member?")) return;
    setActiveAction(`member-delete-${customerId}`);
    try {
      await deleteMember(customerId);
      await fetchMembers();
      showToast("Member deleted", "success");
    } catch {
      showToast("Failed to delete member", "error");
    } finally {
      setActiveAction("");
    }
  }

  async function handleMerge(primaryId, duplicateId, primaryName, duplicateName) {
    if (!confirm(`Merge "${duplicateName}" into "${primaryName}"? This combines visits, spend, and transaction history.`)) return;
    setActiveAction(`member-merge-${primaryId}-${duplicateId}`);
    try {
      await mergeMembers(primaryId, duplicateId);
      await fetchMembers();
      showToast("Member profiles merged", "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to merge members", "error");
    } finally {
      setActiveAction("");
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
          { label: "Total Members", value: totalMembers, color: "var(--text-primary)" },
          { label: "Premium Members", value: premiumCount, color: "var(--warning)" },
          {
            label: "Total Revenue",
            value: `₹${totalRevenue.toLocaleString("en-IN")}`,
            color: "var(--success)",
          },
          { label: "Total Visits", value: totalVisits, color: "var(--accent)" },
        ].map((s, i) => (
          <div
            key={i}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "14px 16px",
              borderTop: `2px solid ${s.color}`,
            }}
          >
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: "6px",
              }}
            >
              {s.label}
            </div>
            <div style={{ fontSize: "var(--text-2xl)", fontWeight: "var(--weight-semibold)", color: s.color }}>
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
                    disabled={!!activeAction}
                  >
                    {activeAction === `member-merge-${group.primary.id}-${match.id}` ? "Merging..." : "Merge"}
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
        <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
          All Members
        </div>
        <button
          className="member-add-btn"
          onClick={handleAdd}
          disabled={!!activeAction}
          data-testid="add-member-button"
        >
          <i className="ti ti-user-plus" aria-hidden="true" />
          <span>{activeAction === "member-add" ? "Adding..." : "Add member"}</span>
        </button>
      </div>

      {members.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            color: "var(--text-muted)",
            padding: "40px 0",
            fontSize: "var(--text-sm)",
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
                  style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", fontSize: "var(--text-base)" }}
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
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
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
                  disabled={!!activeAction}
                >
                  <i
                    className={`ti ${m.typ === "Premium" ? "ti-arrow-down" : "ti-arrow-up"}`}
                    aria-hidden="true"
                  />
                  {activeAction === `member-upgrade-${m.id}` ? "Saving..." : m.typ === "Premium" ? "Downgrade" : "Upgrade"}
                </button>
                <button
                  className="member-action-btn is-delete"
                  onClick={() => handleDelete(m.id)}
                  disabled={!!activeAction}
                >
                  <i className="ti ti-trash" aria-hidden="true" />
                  {activeAction === `member-delete-${m.id}` ? "Deleting..." : "Delete"}
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
                <div className="member-stat-value" style={{ fontSize: "var(--text-base)" }}>
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
