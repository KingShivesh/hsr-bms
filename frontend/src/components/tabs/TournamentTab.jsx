import { useEffect, useMemo, useState } from "react";
import {
  closeTournament,
  createTournament,
  getActive,
  getRates,
  getTournament,
  getTournaments,
  recordTournamentWinner,
} from "../../api/index.js";
import { HSR_TABLES, getTableLabel, getTableRate } from "../../config/hsrTables.js";

const GAME_TYPES = ["8 Ball", "9 Ball", "10 Ball", "Snooker", "Straight Pool"];

function fmtClock(ms) {
  if (!ms) return "--:--";
  return new Date(ms).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function recommendedTypeForGame(gameType) {
  return gameType === "Snooker" ? "SNOOKER" : "POOL";
}

function Panel({ title, children, action }) {
  return (
    <div className="settings-panel">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
          paddingBottom: "12px",
          borderBottom: "1px solid #f0f0f0",
        }}
      >
        <div className="settings-panel-title">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function StatusPill({ status }) {
  const done = status === "completed";
  return (
    <span
      style={{
        fontSize: "10px",
        padding: "2px 8px",
        borderRadius: "999px",
        fontWeight: 700,
        background: done ? "#f0fdf4" : "#eff6ff",
        color: done ? "#16a34a" : "#2563eb",
        border: `1px solid ${done ? "#bbf7d0" : "#bfdbfe"}`,
      }}
    >
      {done ? "COMPLETED" : "ACTIVE"}
    </span>
  );
}

function TournamentTableFloor({ gameType, rates, sessionsByTable }) {
  const preferredType = recommendedTypeForGame(gameType);

  return (
    <div className="tournament-table-grid">
      {HSR_TABLES.map((table) => {
        const session = sessionsByTable[table.id];
        const occupied = !!session;
        const recommended = table.type === preferredType;
        return (
          <div
            key={table.id}
            className={`tournament-table-card ${occupied ? "occupied" : "available"} ${recommended ? "recommended" : ""}`}
          >
            <div className={`tournament-table-felt ${table.type.toLowerCase()}`}>
              <span>T{table.num}</span>
            </div>
            <div className="tournament-table-main">
              <div>
                <strong>{getTableLabel(table)}</strong>
                <span>₹{getTableRate(table, rates)}/hr · {table.type === "POOL" ? "Pool" : "Snooker"}</span>
              </div>
              <em>{occupied ? "Occupied" : "Available"}</em>
            </div>
            <div className="tournament-table-meta">
              {occupied ? (
                <>
                  <span>{session.customer_name}</span>
                  <span>Started {fmtClock(session.start_time)}</span>
                </>
              ) : recommended ? (
                <span>Best fit for {gameType}</span>
              ) : (
                <span>Backup table</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function TournamentTab() {
  const [tournaments, setTournaments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState("Friday Knockout");
  const [gameType, setGameType] = useState("8 Ball");
  const [entryFee, setEntryFee] = useState(0);
  const [playersText, setPlayersText] = useState("");
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState("");
  const [rates, setRates] = useState({ wr: 320, pr: 170, sr: 270 });
  const [activeSessions, setActiveSessions] = useState([]);

  useEffect(() => {
    fetchAll();
    fetchTableState();
    const iv = setInterval(fetchTableState, 10000);
    return () => clearInterval(iv);
    // Run once on mount; later refreshes pass the intended selected tournament explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchAll(nextSelectedId = null) {
    try {
      const res = await getTournaments();
      setTournaments(res.data);
      const id = nextSelectedId || selected?.id || res.data[0]?.id;
      if (id) {
        const detail = await getTournament(id);
        setSelected(detail.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchTableState() {
    try {
      const [activeRes, ratesRes] = await Promise.all([getActive(), getRates()]);
      setActiveSessions(activeRes.data);
      setRates(ratesRes.data);
    } catch (e) {
      console.error(e);
    }
  }

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 2500);
  }

  async function handleCreate() {
    const players = playersText
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    if (players.length < 2) {
      alert("Add at least 2 players, one per line");
      return;
    }
    try {
      const res = await createTournament(
        name,
        gameType,
        parseInt(entryFee) || 0,
        players,
      );
      setPlayersText("");
      showFlash("Tournament created");
      fetchAll(res.data.id);
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to create tournament");
    }
  }

  async function handleSelect(id) {
    try {
      const res = await getTournament(id);
      setSelected(res.data);
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to load tournament");
    }
  }

  async function handleWinner(match, winner) {
    try {
      const res = await recordTournamentWinner(selected.id, match.id, winner);
      setSelected(res.data);
      fetchAll(res.data.id);
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to record winner");
    }
  }

  async function handleClose() {
    if (!selected || !confirm("Close this tournament?")) return;
    try {
      const res = await closeTournament(selected.id);
      setSelected(res.data);
      fetchAll(res.data.id);
    } catch {
      alert("Failed to close tournament");
    }
  }

  const rounds = useMemo(() => {
    const grouped = {};
    (selected?.matches || []).forEach((m) => {
      grouped[m.round_no] = grouped[m.round_no] || [];
      grouped[m.round_no].push(m);
    });
    return Object.entries(grouped).sort(([a], [b]) => Number(a) - Number(b));
  }, [selected]);

  const sessionsByTable = useMemo(() => (
    activeSessions.reduce((acc, session) => {
      acc[String(session.table_id || "").toLowerCase()] = session;
      return acc;
    }, {})
  ), [activeSessions]);

  if (loading) {
    return (
      <div style={{ color: "#bbb", padding: "40px", textAlign: "center" }}>
        Loading tournaments...
      </div>
    );
  }

  return (
    <div className="tournament-layout">
      <div>
        {flash && (
          <div
            style={{
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: "8px",
              padding: "10px 14px",
              color: "#16a34a",
              fontSize: "13px",
              fontWeight: 600,
              marginBottom: "14px",
            }}
          >
            {flash}
          </div>
        )}

        <Panel title="Create Tournament">
          <label className="form-label">Name</label>
          <input
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="form-label">Game</label>
          <select
            className="input-field"
            value={gameType}
            onChange={(e) => setGameType(e.target.value)}
          >
            {GAME_TYPES.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <label className="form-label">Entry Fee</label>
          <input
            type="number"
            className="input-field"
            value={entryFee}
            onChange={(e) => setEntryFee(e.target.value)}
          />
          <label className="form-label">Players</label>
          <textarea
            className="input-field"
            rows={7}
            placeholder={"One player per line\nRahul\nArjun\nVikram"}
            value={playersText}
            onChange={(e) => setPlayersText(e.target.value)}
            style={{ resize: "vertical" }}
          />
          <button className="btn btn-primary-sm" onClick={handleCreate}>
            Create Bracket
          </button>
        </Panel>

        <Panel title="Events">
          {tournaments.length === 0 ? (
            <div style={{ color: "#bbb", fontSize: "13px", padding: "10px 0" }}>
              No tournaments yet
            </div>
          ) : (
            tournaments.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSelect(t.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: selected?.id === t.id ? "#111" : "#fff",
                  color: selected?.id === t.id ? "#fff" : "#111",
                  border: "1px solid #e5e5e5",
                  borderRadius: "8px",
                  padding: "10px 12px",
                  marginBottom: "8px",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 700, fontSize: "13px" }}>{t.name}</span>
                  <StatusPill status={t.status} />
                </div>
                <div style={{ color: selected?.id === t.id ? "#bbb" : "#999", fontSize: "11px", marginTop: "4px" }}>
                  {t.game_type} · ₹{t.entry_fee || 0}
                </div>
              </button>
            ))
          )}
        </Panel>
      </div>

      <div>
        <Panel title="Tournament Table Floor">
          <div className="tournament-floor-note">
            Live table status uses the HSR setup: T1/T2 Wiraka, T3/T4 English, T5 Pool.
          </div>
          <TournamentTableFloor
            gameType={selected?.game_type || gameType}
            rates={rates}
            sessionsByTable={sessionsByTable}
          />
        </Panel>

        {!selected ? (
          <Panel title="Bracket">
            <div style={{ color: "#bbb", padding: "36px", textAlign: "center" }}>
              Create or select a tournament
            </div>
          </Panel>
        ) : (
          <Panel
            title={selected.name}
            action={
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <StatusPill status={selected.status} />
                {selected.status !== "completed" && (
                  <button className="btn btn-warning-sm" onClick={handleClose}>
                    Close
                  </button>
                )}
              </div>
            }
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4,1fr)",
                gap: "12px",
                marginBottom: "18px",
              }}
            >
              {[
                ["Game", selected.game_type],
                ["Players", selected.players.length],
                ["Pot", `₹${(selected.entry_fee * selected.players.length).toLocaleString("en-IN")}`],
                ["Winner", selected.winner_name || "—"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    border: "1px solid #f0f0f0",
                    borderRadius: "8px",
                    padding: "12px",
                    background: "#fff",
                  }}
                >
                  <div style={{ color: "#999", fontSize: "11px", marginBottom: "4px" }}>
                    {label}
                  </div>
                  <div style={{ color: "#111", fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: "14px", overflowX: "auto", paddingBottom: "8px" }}>
              {rounds.map(([roundNo, matches]) => (
                <div key={roundNo} style={{ minWidth: "260px" }}>
                  <div
                    style={{
                      fontSize: "12px",
                      textTransform: "uppercase",
                      color: "#999",
                      fontWeight: 700,
                      marginBottom: "10px",
                    }}
                  >
                    Round {roundNo}
                  </div>
                  {matches.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        border: "1px solid #e5e5e5",
                        borderRadius: "8px",
                        padding: "10px",
                        marginBottom: "10px",
                        background: m.status === "completed" ? "#fafafa" : "#fff",
                      }}
                    >
                      <div style={{ fontSize: "11px", color: "#aaa", marginBottom: "8px" }}>
                        Match {m.match_no}
                      </div>
                      {[m.player1, m.player2].filter(Boolean).map((p) => {
                        const won = m.winner === p;
                        return (
                          <button
                            key={p}
                            disabled={m.status === "completed" || selected.status === "completed"}
                            onClick={() => handleWinner(m, p)}
                            style={{
                              width: "100%",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              border: won ? "1px solid #bbf7d0" : "1px solid #f0f0f0",
                              background: won ? "#f0fdf4" : "#fff",
                              color: won ? "#16a34a" : "#111",
                              borderRadius: "6px",
                              padding: "8px 10px",
                              marginBottom: "6px",
                              cursor: m.status === "completed" ? "default" : "pointer",
                              fontWeight: won ? 700 : 500,
                            }}
                          >
                            <span>{p}</span>
                            <span style={{ fontSize: "11px", color: won ? "#16a34a" : "#bbb" }}>
                              {won ? "Winner" : m.status === "completed" ? "" : "Pick"}
                            </span>
                          </button>
                        );
                      })}
                      {!m.player2 && (
                        <div style={{ color: "#bbb", fontSize: "12px", padding: "4px 2px" }}>
                          Bye advanced automatically
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
