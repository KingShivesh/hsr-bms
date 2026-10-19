import { formatCurrency as polishCurrency } from "../../utils/format.js";
import { Icon as HsrIcon, Input as HsrInput, Button as HsrButton, EmptyState } from "../../components/ui/index.js";
import ContextHelp from "../../product/ContextHelp.jsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCachedState, hasCachedState } from "../../hooks/useCachedState.js";
import {
  addMember,
  deleteMember,
  getMemberDuplicates,
  getMembers,
  mergeMembers,
  restoreMember,
  upgradeMember,
} from "../../api/index.js";
import RetryNotice from "../../components/RetryNotice.jsx";
import { useConfirm } from "../../components/confirmContext.js";
import { useToast } from "../../components/toastContext.js";
import { Button, Drawer } from "../../components/ui/index.js";
import Pagination from "../../components/ui/Pagination.jsx";

function memberName(member) {
  return member.nm || member.name || "Customer";
}

function memberId(member) {
  return member.id || member.customer_id || "";
}

function memberTier(member) {
  return String(member.typ || member.type || "Regular");
}

function memberRestorePayload(member = {}) {
  return {
    name: member.nm || member.name || "",
    phone: member.phone || "",
    visits: Number(member.vis ?? member.visits ?? 0),
    spent: Number(member.spt ?? member.spent ?? 0),
    loyalty_points: Number(member.pts ?? member.loyalty_points ?? 0),
    member_type: member.typ || member.member_type || member.type || "Regular",
    last_visit: member.lst || member.last_visit || "-",
    notes: member.notes || "",
    record_type: member.record_type || "lp_member",
    hourly_rate: member.hourly_rate ?? null,
  };
}

function money(value = 0) { return polishCurrency(value); }

function CustomerSkeleton() {
  return (
    <div className="page-skeleton compact" role="status" aria-live="polite" aria-label="Loading customers">
      <div className="page-skeleton-status">
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
  const [members, setMembers] = useCachedState("members", []);
  const [duplicates, setDuplicates] = useCachedState("member-duplicates", []);
  const [loading, setLoading] = useState(() => !hasCachedState("members"));
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [newName, setNewName] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [busy, setBusy] = useState("");
  const [formError, setFormError] = useState("");
  const newCustomerInputRef = useRef(null);

  const loadCustomers = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading && !hasCachedState("members")) setLoading(true);
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
  }, [setMembers, setDuplicates]);

  useEffect(() => {
    loadCustomers({ showLoading: true });
  }, [loadCustomers]);

  useEffect(() => {
    function handleAddCustomerFocus() {
      newCustomerInputRef.current?.focus();
    }
    window.addEventListener("customers:add-focus", handleAddCustomerFocus);
    return () => window.removeEventListener("customers:add-focus", handleAddCustomerFocus);
  }, []);

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
  const pageSize = 24;
  const safePage = Math.min(page, Math.max(1, Math.ceil(visibleMembers.length / pageSize)));
  const pageMembers = visibleMembers.slice((safePage - 1) * pageSize, safePage * pageSize);

  async function handleAdd(event) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      showToast("Enter customer name", "error");
      return;
    }
    setBusy("add");
    setFormError("");
    const pendingId = `pending-${crypto.randomUUID()}`;
    setMembers(current => [...current, { id: pendingId, nm: name, typ: "Regular", pending: true }]);
    try {
      await addMember(name);
      setNewName("");
      showToast("Customer added", "success");
      await loadCustomers();
    } catch (err) {
      setMembers(current => current.filter(row => memberId(row) !== pendingId));
      setFormError(err.userMessage || "Could not add customer");
      showToast(err.userMessage || "Could not add customer", "error");
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
    const restorePayload = memberRestorePayload(customer);
    setBusy(`delete-${id}`);
    setMembers(current => current.filter(row => memberId(row) !== id));
    try {
      await deleteMember(id);
      setSelectedCustomer((current) => (memberId(current || {}) === id ? null : current));
      showToast(`${restorePayload.name || "Customer"} deleted`, "success", {
        actionLabel: "Undo",
        duration: 5000,
        onAction: async () => {
          setBusy(`restore-${id}`);
          try {
            await restoreMember(id, restorePayload);
            showToast("Customer restored", "success");
            await loadCustomers();
          } catch (err) {
            showToast(err.response?.data?.detail || "Could not restore customer", "error");
          } finally {
            setBusy("");
          }
        },
      });
      await loadCustomers();
    } catch (err) {
      setMembers(current => current.some(row => memberId(row) === id) ? current : [...current, customer]);
      showToast(err.response?.data?.detail || "Could not delete customer", "error");
    } finally {
      setBusy("");
    }
  }

  async function handleMerge(primary, duplicate) {
    const confirmed = await requestConfirm({
      title: "Merge customers?",
      message: `Merge ${duplicate.name} into ${primary.name}? Visits, spend and history will be combined.`,
      confirmLabel: "Merge Profiles",
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
          <HsrInput
            ref={newCustomerInputRef}
            value={newName}
            required
            onBlur={() => setFormError(newName.trim() ? "" : "Enter customer name")}
            aria-invalid={!!formError}
            aria-describedby={formError ? "customer-form-error" : undefined}
            onChange={(event) => { setNewName(event.target.value); if (event.target.value.trim()) setFormError(""); }}
            placeholder="Customer name"
            aria-label="Customer name"
            disabled={!!busy}
          />
          <HsrButton native type="submit" className="lf-primary-button" loading={busy === "add"} disabled={!!busy}>
            <HsrIcon className="ti ti-user-plus" aria-hidden="true" />
            {busy === "add" ? "Adding..." : "Add Customer"}
          </HsrButton>
        </form>
      </div>
      {formError && <p id="customer-form-error" className="ui-field-error" role="alert">{formError}</p>}

      <div className="op2-metric-grid">
        <div><span>Total customers</span><strong>{members.length}</strong><em>{duplicates.length} duplicate group(s)</em></div>
        <div><span>Premium</span><strong>{totals.premium}</strong><em>high-value profiles</em></div>
        <div><span>Total spend</span><strong data-dense={money(totals.totalSpend).length > 12}>{money(totals.totalSpend)}</strong><em>{totals.totalVisits} recorded visits</em></div>
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
                  <HsrIcon className="ti ti-arrows-join" aria-hidden="true" />
                  <div>
                    <strong>{match.name}</strong>
                    <span>{match.id} · {match.score}% match</span>
                  </div>
                  <HsrButton native
                    type="button"
                    className="lf-secondary-button"
                    disabled={!!busy}
                    onClick={() => handleMerge(group.primary, match)}
                  >
                    {busy === `merge-${group.primary.id}-${match.id}` ? "Merging..." : "Merge Profiles"}
                  </HsrButton>
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
            <HsrInput value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search customer..." aria-label="Search customers" />
          </div>
        </div>

        {visibleMembers.length ? (
          <div className="op2-customer-grid">
            {pageMembers.map((member) => {
              const id = memberId(member);
              const tier = memberTier(member);
              const premium = /premium/i.test(tier);
              return (
                <article
                  className="op2-customer-card"
                  key={id || memberName(member)}
                  data-customer-id={id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedCustomer(member)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedCustomer(member);
                    }
                  }}
                >
                  <div className="op2-customer-main">
                    <div>
                      <strong title={memberName(member)}>{memberName(member)}{member.pending ? " · Saving…" : ""}</strong>
                      <span>{id || "No ID"}</span>
                    </div>
                    <em data-tier={tier.toLowerCase()}>{tier}</em>
                  </div>
                  <div className="op2-customer-stats">
                    <div><span>Visits</span><strong>{member.vis || 0}</strong></div>
                    <div className={money(member.spt).length > 12 ? "is-wide" : undefined}><span>Spent</span><strong>{money(member.spt)}</strong></div>
                    <div><span>Last visit</span><strong>{member.lst || "-"}</strong></div>
                  </div>
                  <div className="op2-card-actions">
                    <HsrButton native
                      type="button"
                      className="lf-secondary-button"
                      disabled={!!busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        return handleUpgrade(id, tier);
                      }}
                    >
                      <HsrIcon className={`ti ${premium ? "ti-arrow-down" : "ti-arrow-up"}`} aria-hidden="true" />
                      {busy === `upgrade-${id}` ? "Saving..." : premium ? "Downgrade Tier" : "Upgrade Tier"}
                    </HsrButton>
                    <HsrButton native
                      type="button"
                      className="lf-danger-button"
                      disabled={!!busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        return handleDelete(member);
                      }}
                    >
                      <HsrIcon className="ti ti-trash" aria-hidden="true" />
                      {busy === `delete-${id}` ? "Deleting..." : "Delete Customer"}
                    </HsrButton>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={query.trim() ? "ti-search" : "ti-users"}
            title={query.trim() ? "No customers match your search" : "Keep your regulars in one place"}
            description={query.trim() ? "Try another name or phone number, or clear your search." : "Add your first customer to keep their visits and spend together."}
            action={query.trim() ? (
              <Button icon="ti-x" onClick={() => setQuery("")}>Clear search</Button>
            ) : (
              <Button icon="ti-user-plus" onClick={() => newCustomerInputRef.current?.focus()}>Add Customer</Button>
            )}
          />
        )}
        <Pagination total={visibleMembers.length} page={safePage} pageSize={pageSize} onPageChange={setPage} label="Customers" />
      </section>

      <Drawer
        open={!!selectedCustomer}
        portal
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
                <h3 title={memberName(selectedCustomer)}>{memberName(selectedCustomer)}</h3>
                <p>{memberTier(selectedCustomer)} · Last visit {selectedCustomer.lst || "-"}</p>
              </div>
            </div>
            <div className="checkout-summary-grid">
              <div><span>Visits</span><strong>{selectedCustomer.vis || 0}</strong></div>
              <div className={money(selectedCustomer.spt).length > 12 ? "is-wide" : undefined}><span>Spent</span><strong>{money(selectedCustomer.spt)}</strong></div>
              <div className={money(selectedCustomer.current_balance).length > 12 ? "is-wide" : undefined}><span>Credit outstanding</span><strong>{money(selectedCustomer.current_balance || 0)}</strong></div>
              <div><span>Customer ID</span><strong>{memberId(selectedCustomer) || "-"}</strong></div>
              <div><span>Tier</span><strong>{memberTier(selectedCustomer)}</strong></div>
            </div>
            <ContextHelp label="Help with member credit">Credit outstanding is the member's unpaid balance, not cash collected. Only an existing loyalty member can receive a Credit settlement. Closing a session on Credit updates the balance atomically with its bill; changing a guest name does not create a credit account.</ContextHelp>
            <div className="customer-profile-note">
              <HsrIcon className="ti ti-info-circle" aria-hidden="true" />
              <span>Spend and visits update automatically when a table checkout is completed.</span>
            </div>
            <div className="checkout-actions">
              <Button
                variant="secondary"
                icon={/premium/i.test(memberTier(selectedCustomer)) ? "ti-arrow-down" : "ti-arrow-up"}
                loading={busy === `upgrade-${memberId(selectedCustomer)}`}
                onClick={() => handleUpgrade(memberId(selectedCustomer), memberTier(selectedCustomer))}
              >
                {/premium/i.test(memberTier(selectedCustomer)) ? "Downgrade Tier" : "Upgrade Tier"}
              </Button>
              <Button
                variant="danger"
                icon="ti-trash"
                loading={busy === `delete-${memberId(selectedCustomer)}`}
                onClick={() => handleDelete(selectedCustomer)}
              >
                Delete Customer
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </section>
  );
}
