import { Fragment, useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  getActive,
  getMembers,
  getAnalytics,
  getClosingReport,
  getClosingInsights,
  closeChallenge,
  createChallenge,
  getChallenges,
  matchChallenge,
} from "../api/index.js";
import { HSR_TABLES, TOTAL_TABLES, getTableLabel } from "../config/hsrTables.js";

const TABLES = HSR_TABLES;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const PIE_COLORS = ["#16a34a", "#e11d48", "#d97706"];
const GAME_TYPES = ["8 Ball", "9 Ball", "10 Ball", "Snooker", "Straight Pool"];

function fmt(secs) {
  if (!secs || secs <= 0) return "--:--";
  const h = Math.floor(secs / 3600);
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function SectionTitle({ children }) {
  return (
    <div
      style={{
        fontSize: "12px",
        color: "#999",
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        fontWeight: 500,
        marginBottom: "14px",
      }}
    >
      {children}
    </div>
  );
}

function isFullName(name) {
  return name.trim().split(/\s+/).filter(Boolean).length >= 2;
}

function ChallengeModePanel({ showFlash }) {
  const [challenges, setChallenges] = useState([]);
  const [challengeName, setChallengeName] = useState("");
  const [challengeGame, setChallengeGame] = useState("8 Ball");
  const [challengeTime, setChallengeTime] = useState("");
  const [challengeNote, setChallengeNote] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchChallenges();
  }, []);

  async function fetchChallenges() {
    try {
      const res = await getChallenges();
      setChallenges(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateChallenge(e) {
    e.preventDefault();
    if (!isFullName(challengeName)) {
      alert("Please enter the player's full name.");
      return;
    }
    try {
      await createChallenge({
        player_name: challengeName,
        game_type: challengeGame,
        preferred_time: challengeTime,
        note: challengeNote,
      });
      setChallengeName("");
      setChallengeGame("8 Ball");
      setChallengeTime("");
      setChallengeNote("");
      showFlash("Challenge posted");
      fetchChallenges();
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to create challenge");
    }
  }

  async function handleMatchChallenge(challenge) {
    const opponent = prompt(`Opponent for ${challenge.player_name}:`);
    if (!opponent) return;
    if (!isFullName(opponent)) {
      alert("Please enter the opponent's full name.");
      return;
    }
    try {
      await matchChallenge(challenge.id, opponent);
      showFlash("Challenge matched");
      fetchChallenges();
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to match challenge");
    }
  }

  async function handleCloseChallenge(challengeId) {
    try {
      await closeChallenge(challengeId);
      showFlash("Challenge closed");
      fetchChallenges();
    } catch {
      alert("Failed to close challenge");
    }
  }

  return (
    <div className="panel dashboard-challenge-panel">
      <div className="dashboard-challenge-head">
        <SectionTitle>Challenge mode</SectionTitle>
        <span>{challenges.length} open</span>
      </div>
      <form className="challenge-form dashboard-challenge-form" onSubmit={handleCreateChallenge}>
        <input
          className="input-field"
          placeholder="Player full name"
          value={challengeName}
          onChange={(e) => setChallengeName(e.target.value)}
        />
        <select
          className="input-field"
          value={challengeGame}
          onChange={(e) => setChallengeGame(e.target.value)}
        >
          {GAME_TYPES.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <input
          className="input-field"
          placeholder="Preferred time"
          value={challengeTime}
          onChange={(e) => setChallengeTime(e.target.value)}
        />
        <input
          className="input-field"
          placeholder="Note / stake optional"
          value={challengeNote}
          onChange={(e) => setChallengeNote(e.target.value)}
        />
        <button className="btn btn-primary-sm" type="submit">
          Post Challenge
        </button>
      </form>

      {loading ? (
        <div className="empty-state compact">
          <div className="empty-state-title">Loading challenges...</div>
        </div>
      ) : challenges.length === 0 ? (
        <div className="empty-state compact">
          <div className="empty-state-icon">
            <i className="ti ti-swords" aria-hidden="true" />
          </div>
          <div className="empty-state-title">No open challenges</div>
          <div className="empty-state-detail">
            Post one from the dashboard when a player wants an opponent.
          </div>
        </div>
      ) : (
        <div className="challenge-list dashboard-challenge-list">
          {challenges.slice(0, 5).map((challenge) => (
            <div className="challenge-row" key={challenge.id}>
              <div>
                <strong>{challenge.player_name}</strong>
                <span>
                  {challenge.game_type}
                  {challenge.preferred_time ? ` · ${challenge.preferred_time}` : ""}
                </span>
                {challenge.note && <small>{challenge.note}</small>}
              </div>
              <div className="challenge-actions">
                <button
                  className="member-action-btn is-upgrade"
                  type="button"
                  onClick={() => handleMatchChallenge(challenge)}
                >
                  Match
                </button>
                <button
                  className="member-action-btn is-delete"
                  type="button"
                  onClick={() => handleCloseChallenge(challenge.id)}
                >
                  Close
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TableOccupancyPanel({ sessions, elapsed, onNavigate }) {
  const activeCount = TABLES.filter((t) => sessions[t.id]).length;
  const busyCount = TABLES.filter((t) => (elapsed[t.id] || 0) > 3600).length;
  const idleCount = Math.max(TABLES.length - activeCount, 0);

  return (
    <div className="panel dashboard-occupancy-panel">
      <div className="dashboard-panel-head">
        <div>
          <SectionTitle>Table occupancy</SectionTitle>
          <div className="dashboard-panel-sub">
            {activeCount} active · {idleCount} idle · {busyCount} over 1 hr
          </div>
        </div>
        <button
          className="dashboard-panel-action"
          type="button"
          onClick={() => onNavigate("tables")}
        >
          <i className="ti ti-layout-grid" aria-hidden="true" />
          Floor
        </button>
      </div>
      <div className="hm-legend">
        <div className="hm-legend-item">
          <div className="hm-dot" style={{ background: "#16a34a" }} />
          Active
        </div>
        <div className="hm-legend-item">
          <div className="hm-dot" style={{ background: "#e11d48" }} />
          Busy (&gt;1hr)
        </div>
        <div className="hm-legend-item">
          <div className="hm-dot" style={{ background: "#e5e7eb" }} />
          Idle
        </div>
      </div>
      <div className="heatmap dashboard-occupancy-grid">
        {TABLES.map((t) => {
          const sess = sessions[t.id];
          const secs = elapsed[t.id] || 0;
          const state = !sess ? "idle" : secs > 3600 ? "busy" : "active";
          return (
            <div
              key={t.id}
              className={`hm-cell ${state}`}
              onClick={() => onNavigate("tables")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onNavigate("tables");
              }}
            >
              <div className="hm-num">T{t.num}</div>
              <div className="hm-type">{getTableLabel(t)}</div>
              {sess ? (
                <>
                  <div className="hm-player">
                    {sess.customer_name.split(" ")[0]}
                  </div>
                  <div className="hm-timer">{fmt(secs)}</div>
                </>
              ) : (
                <div className="hm-timer">--:--</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard({ metrics, onNavigate }) {
  const [sessions, setSessions] = useState({});
  const [members, setMembers] = useState([]);
  const [elapsed, setElapsed] = useState({});
  const [analytics, setAnalytics] = useState(null);
  const [digest, setDigest] = useState(null);
  const [flash, setFlash] = useState("");
  const [, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActive() {
      try {
        const res = await getActive();
        const s = {},
          e = {};
        res.data.forEach((x) => {
          s[x.table_id] = x;
          e[x.table_id] = Math.floor(
            (x.paused ? x.elapsed_ms : Date.now() - x.start_time) / 1000,
          );
        });
        setSessions(s);
        setElapsed(e);
      } catch (err) {
        console.error(err);
      }
    }

    async function fetchMembers() {
      try {
        const res = await getMembers();
        setMembers(res.data.slice(0, 5));
      } catch (err) {
        console.error(err);
      }
    }

    async function fetchAnalytics() {
      try {
        const res = await getAnalytics();
        setAnalytics(res.data);
      } catch (err) {
        console.error(err);
      }
    }

    async function fetchDigest() {
      try {
        const [reportRes, insightRes] = await Promise.all([
          getClosingReport(),
          getClosingInsights(),
        ]);
        setDigest({
          report: reportRes.data,
          insights: insightRes.data,
        });
      } catch (err) {
        console.error(err);
      }
    }

    async function fetchAll() {
      await Promise.all([
        fetchActive(),
        fetchMembers(),
        fetchAnalytics(),
        fetchDigest(),
      ]);
      setLoading(false);
    }

    fetchAll();
    const iv = setInterval(fetchActive, 15000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      setElapsed((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((id) => {
          if (!sessions[id]?.paused) next[id] = next[id] + 1;
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [sessions]);

  // Build peak hours grid
  function getPeakCount(day, hour) {
    if (!analytics) return 0;
    const entry = analytics.peak.find((p) => p.key === `${day}-${hour}`);
    return entry ? entry.count : 0;
  }

  function getPeakMax() {
    if (!analytics || analytics.peak.length === 0) return 1;
    return Math.max(...analytics.peak.map((p) => p.count), 1);
  }

  // Pie chart data
  const pieData = analytics
    ? [
        { name: "Pool", value: analytics.breakdown.pool },
        { name: "Snooker", value: analytics.breakdown.snooker },
        { name: "Food", value: analytics.breakdown.food },
      ].filter((d) => d.value > 0)
    : [];

  // MoM change
  const momChange = analytics
    ? analytics.mom.last_month > 0
      ? Math.round(
          ((analytics.mom.this_month - analytics.mom.last_month) /
            analytics.mom.last_month) *
            100,
        )
      : null
    : null;

  function openClosingReport() {
    onNavigate("closing");
  }

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 2500);
  }

  return (
    <div>
      {flash && (
        <div className="dashboard-flash">
          {flash}
        </div>
      )}

      {/* Metrics */}
      <div className="metrics-grid">
        <div className="metric-card green">
          <div className="metric-label">Today's Revenue</div>
          <div className="metric-value">
            ₹{metrics.sale.toLocaleString("en-IN")}
          </div>
          <div className="metric-sub">{metrics.sessions} sessions today</div>
        </div>
        <div className="metric-card blue">
          <div className="metric-label">Active Tables</div>
          <div className="metric-value">
            {metrics.active_tables} / {TOTAL_TABLES}
          </div>
          <div className="metric-sub">
            {Math.max(TOTAL_TABLES - metrics.active_tables, 0)} idle right now
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Customers</div>
          <div className="metric-value">{metrics.cust}</div>
          <div className="metric-sub">Avg {metrics.avg_time}m per session</div>
        </div>
        <div className="metric-card amber">
          <div className="metric-label">Food Sales</div>
          <div className="metric-value">
            ₹{metrics.food.toLocaleString("en-IN")}
          </div>
          <div className="metric-sub">
            {metrics.sale > 0
              ? Math.round((metrics.food / metrics.sale) * 100)
              : 0}
            % of revenue
          </div>
        </div>
      </div>

      <div className="dashboard-at-glance">
        <TableOccupancyPanel
          sessions={sessions}
          elapsed={elapsed}
          onNavigate={onNavigate}
        />

        {digest && (
          <div className="owner-digest">
            <div className="owner-digest-head">
              <div>
                <div className="owner-digest-kicker">Daily owner digest</div>
                <div className="owner-digest-title">{digest.report.date}</div>
              </div>
              <button type="button" className="owner-close-day-btn" onClick={openClosingReport}>
                Close day
                <i className="ti ti-clipboard-check" aria-hidden="true" />
              </button>
            </div>
            <div className="owner-digest-grid">
              <div>
                <span>Revenue</span>
                <strong>₹{digest.report.total_revenue.toLocaleString("en-IN")}</strong>
              </div>
              <div>
                <span>Sessions</span>
                <strong>{digest.report.total_sessions}</strong>
              </div>
              <div>
                <span>Food</span>
                <strong>₹{digest.report.food_revenue.toLocaleString("en-IN")}</strong>
              </div>
              <div>
                <span>Peak hour</span>
                <strong>{digest.report.peak_hour}</strong>
              </div>
            </div>
            <div className="owner-digest-insight">
              <i className="ti ti-bulb" aria-hidden="true" />
              <div>
                <strong>{digest.insights.insights[0]?.title || "Clean close outlook"}</strong>
                <span>{digest.insights.insights[0]?.detail || "No unusual activity detected so far."}</span>
              </div>
            </div>
          </div>
        )}
        {!digest && (
          <div className="owner-digest owner-digest-loading">
            <div className="owner-digest-kicker">Daily owner digest</div>
            <div className="owner-digest-title">Loading...</div>
          </div>
        )}
      </div>

      {/* Row 1: Weekly chart + MoM */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: "16px",
          marginBottom: "16px",
        }}
      >
        {/* Weekly revenue bar chart */}
        <div className="panel">
          <SectionTitle>Revenue — last 7 days</SectionTitle>
          {analytics ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={analytics.weekly} barSize={28}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#bbb" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#bbb" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) =>
                    v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`
                  }
                />
                <Tooltip
                  formatter={(v) => [
                    `₹${v.toLocaleString("en-IN")}`,
                    "Revenue",
                  ]}
                  contentStyle={{
                    background: "#fff",
                    border: "1px solid #f0f0f0",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  cursor={{ fill: "#f5f5f5" }}
                />
                <Bar dataKey="revenue" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div
              style={{
                height: 180,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#bbb",
                fontSize: "13px",
              }}
            >
              Loading chart...
            </div>
          )}
        </div>

        {/* Month over month */}
        <div className="panel">
          <SectionTitle>Month over month</SectionTitle>
          {analytics ? (
            <div>
              <div style={{ marginBottom: "16px" }}>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#bbb",
                    marginBottom: "6px",
                  }}
                >
                  {analytics.mom.this_label}
                </div>
                <div
                  style={{
                    fontSize: "28px",
                    fontWeight: 700,
                    color: "#16a34a",
                  }}
                >
                  ₹{analytics.mom.this_month.toLocaleString("en-IN")}
                </div>
                {momChange !== null && (
                  <div
                    style={{
                      fontSize: "12px",
                      marginTop: "4px",
                      color: momChange >= 0 ? "#16a34a" : "#e11d48",
                      fontWeight: 500,
                    }}
                  >
                    {momChange >= 0 ? "▲" : "▼"} {Math.abs(momChange)}% vs last
                    month
                  </div>
                )}
              </div>
              <div
                style={{ paddingTop: "14px", borderTop: "1px solid #f0f0f0" }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    color: "#bbb",
                    marginBottom: "6px",
                  }}
                >
                  {analytics.mom.last_label}
                </div>
                <div
                  style={{ fontSize: "22px", fontWeight: 600, color: "#111" }}
                >
                  ₹{analytics.mom.last_month.toLocaleString("en-IN")}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: "#bbb", fontSize: "13px" }}>Loading...</div>
          )}
        </div>
      </div>

      {/* Row 2: Heatmap + Donut */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: "16px",
          marginBottom: "16px",
        }}
      >
        {/* Peak hours heatmap */}
        <div className="panel">
          <SectionTitle>Peak hours</SectionTitle>
          <div style={{ overflowX: "auto" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "40px repeat(24, 1fr)",
                gap: "2px",
                minWidth: "600px",
              }}
            >
              {/* Header row — hours */}
              <div />
              {HOURS.map((h) => (
                <div
                  key={h}
                  style={{
                    fontSize: "9px",
                    color: "#bbb",
                    textAlign: "center",
                    paddingBottom: "4px",
                  }}
                >
                  {h}
                </div>
              ))}
              {/* Day rows */}
              {DAYS.map((day, di) => (
                <Fragment key={day}>
                  <div
                    style={{
                      fontSize: "10px",
                      color: "#bbb",
                      display: "flex",
                      alignItems: "center",
                      paddingRight: "6px",
                    }}
                  >
                    {day}
                  </div>
                  {HOURS.map((h) => {
                    const count = getPeakCount(di, h);
                    const max = getPeakMax();
                    const intensity =
                      count === 0 ? 0 : Math.max(0.08, count / max);
                    return (
                      <div
                        key={`${di}-${h}`}
                        title={`${day} ${h}:00 — ${count} sessions`}
                        style={{
                          height: "20px",
                          borderRadius: "3px",
                          background:
                            count === 0
                              ? "#f5f5f5"
                              : `rgba(22, 163, 74, ${intensity})`,
                          border: "1px solid #f0f0f0",
                        }}
                      />
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "10px",
              fontSize: "11px",
              color: "#bbb",
            }}
          >
            <span>Less</span>
            {[0.08, 0.25, 0.5, 0.75, 1].map((op) => (
              <div
                key={op}
                style={{
                  width: "14px",
                  height: "14px",
                  borderRadius: "3px",
                  background: `rgba(22,163,74,${op})`,
                }}
              />
            ))}
            <span>More</span>
          </div>
        </div>

        {/* Revenue breakdown donut */}
        <div className="panel">
          <SectionTitle>Revenue breakdown</SectionTitle>
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => [`₹${v.toLocaleString("en-IN")}`, ""]}
                    contentStyle={{
                      background: "#fff",
                      border: "1px solid #f0f0f0",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                {pieData.map((d, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <div
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: PIE_COLORS[i],
                        }}
                      />
                      <span style={{ color: "#555" }}>{d.name}</span>
                    </div>
                    <span style={{ fontWeight: 600, color: "#111" }}>
                      ₹{d.value.toLocaleString("en-IN")}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div
              style={{
                color: "#bbb",
                fontSize: "13px",
                textAlign: "center",
                padding: "20px 0",
              }}
            >
              No data yet
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Table heatmap + Top members */}
      <div className="dashboard-grid">
        <ChallengeModePanel showFlash={showFlash} />

        {/* Top members */}
        <div className="panel">
          <SectionTitle>Top members</SectionTitle>
          {members.length === 0 ? (
            <div
              style={{
                color: "#bbb",
                fontSize: "13px",
                textAlign: "center",
                padding: "20px 0",
              }}
            >
              No members yet
            </div>
          ) : (
            members.map((m, i) => (
              <div key={i} className="member-row">
                <div>
                  <div className="member-name">{m.nm}</div>
                  <div className="member-id">{m.id}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="member-spent">
                    ₹{m.spt.toLocaleString("en-IN")}
                  </div>
                  <div style={{ marginTop: "3px" }}>
                    <span
                      className={`member-badge ${m.typ === "Premium" ? "badge-premium" : "badge-regular"}`}
                    >
                      {m.typ.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
          <div
            style={{
              marginTop: "12px",
              fontSize: "12px",
              color: "#2563eb",
              cursor: "pointer",
              textAlign: "right",
            }}
            onClick={() => onNavigate("members")}
          >
            View all members →
          </div>
        </div>
      </div>
    </div>
  );
}
