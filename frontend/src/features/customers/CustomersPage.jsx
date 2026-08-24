import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMember,
  deleteMember,
  getMemberDuplicates,
  getMembers,
  mergeMembers,
  upgradeMember,
} from "../../api/index.js";
import RetryNotice from "../../components/RetryNotice.jsx";
import { useConfirm } from "../../components/confirmContext.js";
import { useToast } from "../../components/toastContext.js";
import { Button, Drawer } from "../../components/ui/index.js";

function memberName(member) {
  return member.nm || member.name || "Customer";
}

function memberId(member) {
  return member.id || member.customer_id || "";
}

function memberTier(member) {
  return String(member.typ || member.type || "Regular");
}

function money(value = 0) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function CustomerSkeleton() {
  return (
    <div className="page-skeleton compact" role="status" aria-live="polite" aria-label="Loading customers">
      <div className="page-skeleton-status">
        <i className="ti ti-loader-2" aria-hidden="true" />
        <span>Loading customers...</span>
      </div>
      <div className="skeleton-grid">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
      <div className="skeleton-panel" />
    </div>
  );
}

export default function CustomersPage() {
  const { showToast } = useToast();
  const { requestConfirm } = useConfirm();
  const [members, setMembers] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [busy, setBusy] = useState("");

  const loadCustomers = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const [memberRes, duplicateRes] = await Promise.all([getMembers(), getMemberDuplicates()]);
      setMembers(Array.isArray(memberRes.data) ? memberRes.data : []);
      setDuplicates(Array.isArray(duplicateRes.data) ? duplicateRes.data : []);
    } catch (err) {
      setError(err.userMessage || "Customers could not load.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustomers({ showLoading: true });
  }, [loadCustomers]);

  const totals = useMemo(() => {
    const totalSpend = members.reduce((sum, member) => sum + Number(member.spt || member.spent || 0), 0);
    const totalVisits = members.reduce((sum, member) => sum + Number(member.vis || member.visits || 0), 0);
    const premium = members.filter((member) => /premium/i.test(memberTier(member))).length;
    return { totalSpend, totalVisits, premium };
  }, [members]);

  const visibleMembers = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    return members
      .filter((member) => {
        if (!cleanQuery) return true;
        return [memberName(member), memberId(member), memberTier(member)]
          .some((value) => String(value || "").toLowerCase().includes(cleanQuery));
      })
      .sort((a, b) => Number(b.spt || 0) - Number(a.spt || 0));
  }, [members, query]);

  async function handleAdd(event) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      showToast("Enter customer name", "error");
      return;
    }
    setBusy("add");
    try {
      await addMember(name);
      setNewName("");
      showToast("Customer added", "success");
      await loadCustomers();
    } catch (err) {
      showToast(err.response?.data?.detail || "Could not add customer", "error");
    } finally {
      setBusy("");
    }
  }

  async function handleUpgrade(customerId, tier) {
    setBusy(`upgrade-${customerId}`);
    try {
      await upgradeMember(customerId);
      showToast(/premium/i.test(tier) ? "Customer downgraded" : "Customer upgraded", "success");
      await loadCustomers();
    } catch (err) {
      showToast(err.response?.data?.detail || "Could not update customer", "error");
    } finally {
      setBusy("");
    }
  }

  async function handleDelete(customer) {
    const id = memberId(customer);
    const confirmed = await requestConfirm({
      title: "Delete customer?",
      message: `Delete ${memberName(customer)} from customer records?`,
      confirmLabel: "Delete customer",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(`delete-${id}`);
    try {
      await deleteMember(id);
      showToast("Customer deleted", "success");
      await loadCustomers();
    } catch (err) {
      showToast(err.response?.data?.detail || "Could not delete customer", "error");
    } finally {
      setBusy("");
    }
  }

  async function handleMerge(primary, duplicate) {
    const confirmed = await requestConfirm({
      title: "Merge customers?",
      message: `Merge ${duplicate.name} into ${primary.name}? Visits, spend and history will be combined.`,
      confirmLabel: "Merge profiles",
      tone: "warning",
    });
    if (!confirmed) return;
    setBusy(`merge-${primary.id}-${duplicate.id}`);
    try {
      await mergeMembers(primary.id, duplicate.id);
      showToast("Customer profiles merged", "success");
      await loadCustomers();
    } catch (err) {
      showToast(err.response?.data?.detail || "Could not merge customers", "error");
    } finally {
      setBusy("");
    }
  }

  if (loading) return <CustomerSkeleton />;

  return (
    <section className="op2-page">
      {error && <RetryNotice message={error} detail="Customer CRM may be stale until this loads." onRetry={() => loadCustomers({ showLoading: true })} />}

      <div className="op2-hero">
        <div>
          <span className="lf-eyebrow">Customers</span>
          <h1>Customer CRM</h1>
          <p>Track regulars, spend, visits and duplicate profiles without leaving the operating system.</p>
        </div>
        <form className="op2-inline-form" onSubmit={handleAdd}>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Customer name"
            aria-label="Customer name"
            disabled={!!busy}
          />
          <button type="submit" className="lf-primary-button" disabled={!!busy}>
            <i className="ti ti-user-plus" aria-hidden="true" />
            {busy === "add" ? "Adding..." : "Add customer"}
          </button>
        </form>
      </div>

      <div className="op2-metric-grid">
        <div><span>Total customers</span><strong>{members.length}</strong><em>{duplicates.length} duplicate group(s)</em></div>
        <div><span>Premium</span><strong>{totals.premium}</strong><em>high-value profiles</em></div>
        <div><span>Total spend</span><strong>{money(totals.totalSpend)}</strong><em>{totals.totalVisits} recorded visits</em></div>
      </div>

      {!!duplicates.length && (
        <section className="op2-panel">
          <div className="op2-panel-head">
            <div>
              <span className="lf-eyebrow">Data quality</span>
              <h2>Duplicate suggestions</h2>
            </div>
          </div>
          <div className="op2-register-list">
            {duplicates.flatMap((group) =>
              group.matches.map((match) => (
                <article className="op2-register-row" key={`${group.primary.id}-${match.id}`}>
                  <div>
                    <strong>{group.primary.name}</strong>
                    <span>{group.primary.id} · {money(group.primary.spent)}</span>
                  </div>
                  <i className="ti ti-arrows-join" aria-hidden="true" />
                  <div>
                    <strong>{match.name}</strong>
                    <span>{match.id} · {match.score}% match</span>
                  </div>
                  <button
                    type="button"
                    className="lf-secondary-button"
                    disabled={!!busy}
                    onClick={() => handleMerge(group.primary, match)}
                  >
                    {busy === `merge-${group.primary.id}-${match.id}` ? "Merging..." : "Merge"}
                  </button>
                </article>
              )),
            )}
          </div>
        </section>
      )}

      <section className="op2-panel">
        <div className="op2-panel-head">
          <div>
            <span className="lf-eyebrow">Register</span>
            <h2>All customers</h2>
          </div>
          <div className="op2-controls">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer..." />
          </div>
        </div>

        {visibleMembers.length ? (
          <div className="op2-customer-grid">
            {visibleMembers.map((member) => {
              const id = memberId(member);
              const tier = memberTier(member);
              const premium = /premium/i.test(tier);
              return (
                <article
                  className="op2-customer-card"
                  key={id || memberName(member)}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedCustomer(member)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedCustomer(member);
                    }
                  }}
                >
                  <div className="op2-customer-main">
                    <div>
                      <strong>{memberName(member)}</strong>
                      <span>{id || "No ID"}</span>
                    </div>
                    <em data-tier={tier.toLowerCase()}>{tier}</em>
                  </div>
                  <div className="op2-customer-stats">
                    <div><span>Visits</span><strong>{member.vis || 0}</strong></div>
                    <div><span>Spent</span><strong>{money(member.spt)}</strong></div>
                    <div><span>Last visit</span><strong>{member.lst || "-"}</strong></div>
                  </div>
                  <div className="op2-card-actions">
                    <button
                      type="button"
                      className="lf-secondary-button"
                      disabled={!!busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleUpgrade(id, tier);
                      }}
                    >
                      <i className={`ti ${premium ? "ti-arrow-down" : "ti-arrow-up"}`} aria-hidden="true" />
                      {busy === `upgrade-${id}` ? "Saving..." : premium ? "Downgrade" : "Upgrade"}
                    </button>
                    <button
                      type="button"
                      className="lf-danger-button"
                      disabled={!!busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDelete(member);
                      }}
                    >
                      <i className="ti ti-trash" aria-hidden="true" />
                      {busy === `delete-${id}` ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="op2-empty">
            <i className="ti ti-users" aria-hidden="true" />
            <strong>No customers found</strong>
            <span>Add a customer or change the search query.</span>
          </div>
        )}
      </section>

      <Drawer
        open={!!selectedCustomer}
        title={selectedCustomer ? memberName(selectedCustomer) : "Customer"}
        description={selectedCustomer ? `${memberId(selectedCustomer) || "No ID"} · ${memberTier(selectedCustomer)}` : ""}
        onClose={() => setSelectedCustomer(null)}
        className="customer-profile-drawer"
      >
        {selectedCustomer && (
          <div className="customer-profile">
            <div className="customer-profile-hero">
              <div className="customer-avatar">{memberName(selectedCustomer).slice(0, 2).toUpperCase()}</div>
              <div>
                <span className="lf-eyebrow">Customer profile</span>
                <h3>{memberName(selectedCustomer)}</h3>
                <p>{memberTier(selectedCustomer)} · Last visit {selectedCustomer.lst || "-"}</p>
              </div>
            </div>
            <div className="checkout-summary-grid">
              <div><span>Visits</span><strong>{selectedCustomer.vis || 0}</strong></div>
              <div><span>Spent</span><strong>{money(selectedCustomer.spt)}</strong></div>
              <div><span>Customer ID</span><strong>{memberId(selectedCustomer) || "-"}</strong></div>
              <div><span>Tier</span><strong>{memberTier(selectedCustomer)}</strong></div>
            </div>
            <div className="customer-profile-note">
              <i className="ti ti-info-circle" aria-hidden="true" />
              <span>Spend and visits update automatically when a table checkout is completed.</span>
            </div>
            <div className="checkout-actions">
              <Button
                variant="secondary"
                icon={/premium/i.test(memberTier(selectedCustomer)) ? "ti-arrow-down" : "ti-arrow-up"}
                loading={busy === `upgrade-${memberId(selectedCustomer)}`}
                onClick={() => handleUpgrade(memberId(selectedCustomer), memberTier(selectedCustomer))}
              >
                {/premium/i.test(memberTier(selectedCustomer)) ? "Downgrade" : "Upgrade"}
              </Button>
              <Button
                variant="danger"
                icon="ti-trash"
                loading={busy === `delete-${memberId(selectedCustomer)}`}
                onClick={() => handleDelete(selectedCustomer)}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </section>
  );
}
