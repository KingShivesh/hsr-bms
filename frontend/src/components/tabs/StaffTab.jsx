const STAFF = [
  {
    id: "ST-01",
    name: "Karthik V",
    role: "Manager",
    shift: "Evening (04:00 - 12:00)",
    phone: "+91 98860 12345",
    attendanceStatus: "On Duty",
    tablesServedToday: 12,
    rating: 4.8,
  },
  {
    id: "ST-02",
    name: "Preeti Nair",
    role: "Cashier",
    shift: "Evening (04:00 - 12:00)",
    phone: "+91 97412 88901",
    attendanceStatus: "On Duty",
    tablesServedToday: 8,
    rating: 4.7,
  },
  {
    id: "ST-03",
    name: "Ramesh G",
    role: "Floor Staff",
    shift: "Night (08:00 - 02:00)",
    phone: "+91 99001 54321",
    attendanceStatus: "Off Duty",
    tablesServedToday: 0,
    rating: 4.5,
  },
];

export default function StaffTab() {
  const onDuty = STAFF.filter((member) => member.attendanceStatus === "On Duty").length;
  const served = STAFF.reduce((sum, member) => sum + member.tablesServedToday, 0);

  return (
    <div className="clubflow-page">
      <section className="clubflow-hero">
        <div>
          <span className="clubflow-eyebrow">Team operations</span>
          <h2>Staff & Roster</h2>
          <p>Shift coverage, attendance and floor performance at a glance.</p>
        </div>
        <div className="clubflow-hero-stats">
          <div>
            <strong>{onDuty}</strong>
            <span>On duty</span>
          </div>
          <div>
            <strong>{served}</strong>
            <span>Tables served</span>
          </div>
        </div>
      </section>

      <div className="clubflow-card-grid">
        {STAFF.map((member) => (
          <article className="clubflow-card staff" key={member.id}>
            <div className="clubflow-card-top">
              <div className="clubflow-avatar">{member.name.split(" ").map((p) => p[0]).join("")}</div>
              <span className={`clubflow-chip ${member.attendanceStatus === "On Duty" ? "green" : "slate"}`}>
                {member.attendanceStatus}
              </span>
            </div>
            <h3>{member.name}</h3>
            <p>{member.role} · {member.phone}</p>
            <div className="clubflow-card-meta">
              <span>{member.shift}</span>
              <span>{member.rating} rating</span>
            </div>
            <div className="clubflow-mini-grid compact">
              <div>
                <span>Tables</span>
                <strong>{member.tablesServedToday}</strong>
              </div>
              <div>
                <span>Role</span>
                <strong>{member.role}</strong>
              </div>
            </div>
          </article>
        ))}
      </div>

      <section className="clubflow-panel">
        <div className="clubflow-panel-head">
          <div>
            <h3>Shift Coverage</h3>
            <p>Use this as a lightweight duty board for the owner.</p>
          </div>
          <span className="clubflow-chip green">Healthy</span>
        </div>
        <div className="clubflow-timeline">
          <div><strong>04:00 PM</strong><span>Evening cashier and manager active</span></div>
          <div><strong>08:00 PM</strong><span>Night floor staff handover</span></div>
          <div><strong>12:00 AM</strong><span>Cash reconciliation and closing prep</span></div>
        </div>
      </section>
    </div>
  );
}
