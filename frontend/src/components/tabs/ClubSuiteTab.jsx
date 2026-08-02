import { useEffect, useMemo, useState } from "react";
import {
  getAuditLogs,
  getBookings,
  getFoodOrders,
  getFoodStats,
  getHistory,
  getMaintenance,
  getMenuFull,
  getTableUtilization,
  getTopCustomers,
  getWaitlist,
} from "../../api/index.js";
import { HSR_TABLES } from "../../config/hsrTables.js";

function money(value = 0) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.menu)) return value.menu;
  if (Array.isArray(value.data)) return value.data;
  return Object.entries(value).map(([name, item]) => (
    item && typeof item === "object"
      ? { name, ...item }
      : { name, price: Number(item || 0), available: true }
  ));
}

function shortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Section({ eyebrow, title, action, children }) {
  return (
    <section className="cf-panel">
      <div className="cf-section-head">
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, icon, tone = "blue" }) {
  return (
    <article className={`cf-stat ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <i className={`ti ${icon}`} aria-hidden="true" />
    </article>
  );
}

function EmptyState({ icon = "ti-info-circle", title, detail }) {
  return (
    <div className="cf-empty">
      <i className={`ti ${icon}`} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function SuiteHero({ eyebrow, title, detail, tone = "blue", metrics = [] }) {
  return (
    <div className={`cf-hero cf-hero-${tone}`}>
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      {!!metrics.length && (
        <div className="cf-hero-metrics">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <strong>{metric.value}</strong>
              <small>{metric.label}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RowList({ rows }) {
  if (!rows.length) {
    return (
      <EmptyState
        icon="ti-circle-check"
        title="Nothing pending"
        detail="This area will populate automatically as staff use the system."
      />
    );
  }
  return (
    <div className="cf-row-list">
      {rows.map((row) => (
        <div className="cf-row" key={row.id}>
          <i className={`ti ${row.icon}`} aria-hidden="true" />
          <div>
            <strong>{row.title}</strong>
            <span>{row.detail}</span>
          </div>
          {row.amount && <em>{row.amount}</em>}
        </div>
      ))}
    </div>
  );
}

function WaitlistView({ waitlist, bookings }) {
  const missed = bookings.filter((booking) => booking.status === "missed");
  const upcoming = bookings.filter((booking) => booking.status === "booked");
  return (
    <div className="cf-page cf-page-queue">
      <SuiteHero
        tone="amber"
        eyebrow="Reception flow"
        title="Smart Waitlist Queue"
        detail="Track walk-ins, queue pressure and booking conflicts before they become front-desk confusion."
        metrics={[
          { label: "waiting", value: waitlist.length },
          { label: "booked", value: upcoming.length },
          { label: "missed", value: missed.length },
        ]}
      />
      <div className="cf-stat-grid">
        <Stat label="Waiting" value={waitlist.length} icon="ti-user-clock" tone="purple" />
        <Stat label="Upcoming Bookings" value={upcoming.length} icon="ti-calendar-event" />
        <Stat label="Missed Bookings" value={missed.length} icon="ti-alert-circle" tone="amber" />
      </div>
      <div className="cf-two-col">
        <Section eyebrow="Queue" title="Walk-ins Waiting">
          <RowList
            rows={waitlist.map((entry) => ({
              id: `wait-${entry.id}`,
              icon: "ti-clock",
              title: `${entry.position}. ${entry.customer_name}`,
              detail: `${entry.party_size} player(s) · ${entry.preferred_type || "Any table"} · ${entry.wait_mins || 0} min wait`,
            }))}
          />
        </Section>
        <Section eyebrow="Bookings" title="Upcoming / Missed">
          <RowList
            rows={[...upcoming, ...missed].slice(0, 10).map((booking) => ({
              id: `booking-${booking.id}`,
              icon: booking.status === "missed" ? "ti-alert-triangle" : "ti-calendar",
              title: booking.customer_name,
              detail: `${booking.table_id || "ANY"} · ${shortDate(booking.booking_time)} · ${booking.status}`,
            }))}
          />
        </Section>
      </div>
    </div>
  );
}

function ReservationsView({ bookings }) {
  const booked = bookings.filter((booking) => booking.status === "booked");
  const tableBookings = HSR_TABLES.map((table) => ({
    table,
    bookings: booked.filter((booking) => String(booking.table_id).toLowerCase() === table.id),
  }));
  return (
    <div className="cf-page cf-page-reservations">
      <SuiteHero
        tone="purple"
        eyebrow="Reservation desk"
        title="Reservations & Slots"
        detail="See table-wise commitments and no-show risk without digging into the table floor."
        metrics={[
          { label: "active bookings", value: booked.length },
          { label: "tables covered", value: tableBookings.filter((row) => row.bookings.length).length },
        ]}
      />
      <div className="cf-calendar-grid">
        {tableBookings.map(({ table, bookings: rows }) => (
          <section className="cf-table-slot" key={table.id}>
            <div>
              <strong>T{table.num}</strong>
              <span>{table.label || table.type || table.id}</span>
            </div>
            {rows.length ? (
              rows.slice(0, 3).map((booking) => (
                <p key={booking.id}>
                  <b>{booking.customer_name}</b>
                  <small>{shortDate(booking.booking_time)}</small>
                </p>
              ))
            ) : (
              <em>Open slots</em>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function BillingView({ history, foodOrders }) {
  const tableTotal = history.reduce((sum, bill) => sum + Number(bill.total || bill.amount || 0), 0);
  const foodTotal = foodOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const recentBills = history.slice(0, 12).map((bill) => ({
    id: `bill-${bill.id || bill.date}-${bill.table_id}`,
    icon: "ti-receipt",
    title: `${bill.table_id || "Table"} · ${bill.customer_name || "Customer"}`,
    detail: `${bill.payment_method || "Cash"} · ${bill.date || ""}`,
    amount: money(bill.total || bill.amount || 0),
  }));
  const foodRows = foodOrders.slice(0, 6).map((order) => ({
    id: `food-${order.id}`,
    icon: "ti-tools-kitchen-2",
    title: order.customer_name || "Counter order",
    detail: `${order.payment_method || "Cash"} · ${order.items?.length || 0} item(s)`,
    amount: money(order.total),
  }));
  return (
    <div className="cf-page cf-page-billing">
      <SuiteHero
        tone="blue"
        eyebrow="Money desk"
        title="Billing & Invoices"
        detail="Fast view of table settlements and cafe bills, designed for cashier reconciliation."
        metrics={[
          { label: "table bill value", value: money(tableTotal) },
          { label: "food bill value", value: money(foodTotal) },
        ]}
      />
      <div className="cf-two-col">
        <Section eyebrow="Tables" title="Recent Table Bills">
          <RowList rows={recentBills} />
        </Section>
        <Section eyebrow="Cafe" title="Recent Food Bills">
          <RowList rows={foodRows} />
        </Section>
      </div>
    </div>
  );
}

function InventoryView({ menu, maintenance }) {
  const unavailable = menu.filter((item) => item.available === false);
  const cigarettes = menu.filter((item) => /cig|cigg|cigarette/i.test(item.name));
  return (
    <div className="cf-page cf-page-inventory">
      <SuiteHero
        tone="green"
        eyebrow="Stock control"
        title="Inventory & Stocks"
        detail="Operational stock visibility for cafe availability, cigarettes and table maintenance."
        metrics={[
          { label: "menu items", value: menu.length },
          { label: "out of stock", value: unavailable.length },
          { label: "maintenance", value: maintenance.length },
        ]}
      />
      <div className="cf-stat-grid">
        <Stat label="Menu Items" value={menu.length} icon="ti-package" />
        <Stat label="Out of Stock" value={unavailable.length} icon="ti-alert-circle" tone="amber" />
        <Stat label="Cigarette Items" value={cigarettes.length} icon="ti-smoking" tone="purple" />
      </div>
      <div className="cf-two-col">
        <Section eyebrow="Availability" title="Unavailable Items">
          <RowList
            rows={unavailable.map((item) => ({
              id: `menu-${item.name}`,
              icon: "ti-package-off",
              title: item.name,
              detail: `${item.category || "Menu"} · ${money(item.price)}`,
            }))}
          />
        </Section>
        <Section eyebrow="Floor" title="Maintenance Tables">
          <RowList
            rows={maintenance.map((row) => ({
              id: `maint-${row.table_id}`,
              icon: "ti-tool",
              title: String(row.table_id || "").toUpperCase(),
              detail: row.reason || "Marked for maintenance",
            }))}
          />
        </Section>
      </div>
    </div>
  );
}

function NotificationsView({ auditLogs, waitlist, bookings, maintenance }) {
  const notifications = [
    ...maintenance.map((row) => ({
      id: `maint-${row.table_id}`,
      icon: "ti-tool",
      title: `${String(row.table_id).toUpperCase()} in maintenance`,
      detail: row.reason || "Needs owner review",
    })),
    ...waitlist.map((entry) => ({
      id: `wait-${entry.id}`,
      icon: "ti-user-clock",
      title: `${entry.customer_name} waiting`,
      detail: `${entry.wait_mins || 0} min in queue`,
    })),
    ...bookings.filter((booking) => booking.status === "missed").map((booking) => ({
      id: `missed-${booking.id}`,
      icon: "ti-alert-triangle",
      title: `Missed booking: ${booking.customer_name}`,
      detail: shortDate(booking.booking_time),
    })),
    ...auditLogs.slice(0, 8).map((log) => ({
      id: `audit-${log.id}`,
      icon: log.severity === "danger" ? "ti-alert-triangle" : "ti-activity",
      title: log.action?.replaceAll("_", " ") || "System activity",
      detail: log.detail || log.date || "",
    })),
  ];
  return (
    <div className="cf-page cf-page-notifications">
      <SuiteHero
        tone="red"
        eyebrow="Control alerts"
        title="Notification Center"
        detail="One place for missed bookings, waitlist pressure, maintenance and sensitive audit events."
        metrics={[
          { label: "alerts", value: notifications.length },
          { label: "audit events", value: auditLogs.length },
        ]}
      />
      <Section eyebrow="Alerts" title="Live Notifications">
        <RowList rows={notifications} />
      </Section>
    </div>
  );
}

function MembershipPlansView({ topCustomers }) {
  const plans = [
    { name: "Silver", price: 499, benefit: "Basic profile, visit tracking and 5% courtesy discount marker." },
    { name: "Gold", price: 999, benefit: "Priority booking marker, higher spend visibility and 10% discount marker." },
    { name: "Premium VIP", price: 1999, benefit: "VIP tag, best customer tracking and preferred table history." },
  ];
  return (
    <div className="cf-page cf-page-memberships">
      <SuiteHero
        tone="purple"
        eyebrow="Loyalty"
        title="Membership Plans"
        detail="A simple membership surface for repeat players, VIPs and owner-level customer focus."
        metrics={[
          { label: "plans", value: plans.length },
          { label: "targets", value: topCustomers.length },
        ]}
      />
      <div className="cf-plan-grid">
        {plans.map((plan) => (
          <section className="cf-plan" key={plan.name}>
            <span>{plan.name}</span>
            <strong>{money(plan.price)}<small>/mo</small></strong>
            <p>{plan.benefit}</p>
          </section>
        ))}
      </div>
      <Section eyebrow="Customers" title="Top Customer Targets">
        <RowList
          rows={topCustomers.slice(0, 8).map((customer, index) => ({
            id: customer.customer_id || `${customer.name}-${index}`,
            icon: "ti-user-star",
            title: customer.name || customer.customer_name || "Customer",
            detail: `${customer.visits || customer.sessions || 0} visits`,
            amount: money(customer.spent || customer.total || customer.revenue || 0),
          }))}
        />
      </Section>
    </div>
  );
}

function StaffView({ auditLogs }) {
  const staffMap = auditLogs.reduce((acc, log) => {
    const key = log.staff || "system";
    acc[key] = acc[key] || { actions: 0, risk: 0 };
    acc[key].actions += 1;
    if (log.severity === "danger") acc[key].risk += 1;
    return acc;
  }, {});
  const rows = Object.entries(staffMap).map(([staff, value]) => ({
    id: staff,
    icon: "ti-user-check",
    title: staff,
    detail: `${value.actions} logged action(s) · ${value.risk} risk action(s)`,
  }));
  return (
    <div className="cf-page cf-page-staff">
      <SuiteHero
        tone="slate"
        eyebrow="Team overview"
        title="Staff & Roster"
        detail="Lightweight staff activity view using the audit trail, without adding heavy HR complexity."
        metrics={[
          { label: "staff/system actors", value: rows.length },
          { label: "logged actions", value: auditLogs.length },
        ]}
      />
      <Section eyebrow="Activity" title="Staff Action Summary">
        <RowList rows={rows} />
      </Section>
    </div>
  );
}

export default function ClubSuiteTab({ view }) {
  const [data, setData] = useState({
    waitlist: [],
    bookings: [],
    history: [],
    foodOrders: [],
    foodStats: [],
    menu: [],
    maintenance: [],
    auditLogs: [],
    topCustomers: [],
    utilization: [],
  });

  useEffect(() => {
    let alive = true;
    async function load() {
      const results = await Promise.allSettled([
        getWaitlist(),
        getBookings(),
        getHistory(),
        getFoodOrders(),
        getFoodStats(),
        getMenuFull(),
        getMaintenance(),
        getAuditLogs(50),
        getTopCustomers("all"),
        getTableUtilization(),
      ]);
      if (!alive) return;
      setData({
        waitlist: results[0].status === "fulfilled" ? asArray(results[0].value.data) : [],
        bookings: results[1].status === "fulfilled" ? asArray(results[1].value.data) : [],
        history: results[2].status === "fulfilled" ? asArray(results[2].value.data) : [],
        foodOrders: results[3].status === "fulfilled" ? asArray(results[3].value.data) : [],
        foodStats: results[4].status === "fulfilled" ? asArray(results[4].value.data) : [],
        menu: results[5].status === "fulfilled" ? asArray(results[5].value.data) : [],
        maintenance: results[6].status === "fulfilled" ? asArray(results[6].value.data) : [],
        auditLogs: results[7].status === "fulfilled" ? asArray(results[7].value.data) : [],
        topCustomers: results[8].status === "fulfilled" ? asArray(results[8].value.data) : [],
        utilization: results[9].status === "fulfilled" ? asArray(results[9].value.data) : [],
      });
    }
    load();
    return () => {
      alive = false;
    };
  }, [view]);

  const props = useMemo(() => data, [data]);

  if (view === "waitlist") return <WaitlistView {...props} />;
  if (view === "reservations") return <ReservationsView {...props} />;
  if (view === "billing") return <BillingView {...props} />;
  if (view === "inventory") return <InventoryView {...props} />;
  if (view === "notifications") return <NotificationsView {...props} />;
  if (view === "memberships") return <MembershipPlansView {...props} />;
  if (view === "staff") return <StaffView {...props} />;
  return <WaitlistView {...props} />;
}
