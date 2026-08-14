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
import { HSR_TABLES } from "../../config/hsrTables.js";
import TableStatusCard from "../TableStatusCard.jsx";
import { useToast } from "../toastContext.js";

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
          borderBottom: "1px solid var(--border)",
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
        fontSize: "var(--text-xs)",
        padding: "2px 8px",
        borderRadius: "999px",
        fontWeight: "var(--weight-bold)",
        background: done ? "var(--success-bg)" : "var(--accent-bg)",
        color: done ? "var(--success)" : "var(--accent)",
        border: `1px solid ${done ? "color-mix(in srgb, var(--success) 28%, var(--border))" : "color-mix(in srgb, var(--accent) 28%, var(--border))"}`,
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
        const detail = occupied
          ? `${session.customer_name || "Player"} · Started ${fmtClock(session.start_time)}`
          : recommended
            ? `Best fit for ${gameType}`
            : "Backup table";
        return (
          <TableStatusCard
            key={table.id}
            table={table}
            session={session}
            rates={rates}
            recommended={recommended}
            recommendedLabel={`Best fit for ${gameType}`}
            detail={detail}
          />
        );
      })}
    </div>
  );
}

export default function TournamentTab() {
  const { showToast } = useToast();
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
  const [activeAction, setActiveAction] = useState("");

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
      showToast("Add at least 2 players, one per line", "error");
      return;
    }
    setActiveAction("tournament-create");
    try {
      const res = await createTournament(
        name,
        gameType,
        parseInt(entryFee) || 0,
        players,
      );
      setPlayersText("");
      showFlash("Tournament created");
      showToast("Tournament created", "success");
      await fetchAll(res.data.id);
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to create tournament", "error");
    } finally {
      setActiveAction("");
    }
  }

  async function handleSelect(id) {
    setActiveAction(`tournament-select-${id}`);
    try {
      const res = await getTournament(id);
      setSelected(res.data);
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to load tournament", "error");
    } finally {
      setActiveAction("");
    }
  }

  async function handleWinner(match, winner) {
    setActiveAction(`winner-${match.id}-${winner}`);
    try {
      const res = await recordTournamentWinner(selected.id, match.id, winner);
      setSelected(res.data);
      await fetchAll(res.data.id);
      showToast(`${winner} marked winner`, "success");
    } catch (e) {
      showToast(e.response?.data?.detail || "Failed to record winner", "error");
    } finally {
      setActiveAction("");
    }
  }

  async function handleClose() {
    if (!selected || !confirm("Close this tournament?")) return;
    setActiveAction("tournament-close");
    try {
      const res = await closeTournament(selected.id);
      setSelected(res.data);
      await fetchAll(res.data.id);
      showToast("Tournament closed", "success");
    } catch {
      showToast("Failed to close tournament", "error");
    } finally {
      setActiveAction("");
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
      <div style={{ color: "var(--text-muted)", padding: "40px", textAlign: "center" }}>
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
              background: "var(--success-bg)",
              border: "1px solid color-mix(in srgb, var(--success) 28%, var(--border))",
              borderRadius: "var(--radius-sm)",
              padding: "10px 14px",
              color: "var(--success)",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-semibold)",
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
          <button className="btn btn-primary-sm" onClick={handleCreate} disabled={!!activeAction}>
            {activeAction === "tournament-create" ? "Creating..." : "Create Bracket"}
          </button>
        </Panel>

        <Panel title="Events">
          {tournaments.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", padding: "10px 0" }}>
              No tournaments yet
            </div>
          ) : (
            tournaments.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSelect(t.id)}
                disabled={!!activeAction}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: selected?.id === t.id ? "var(--text-primary)" : "var(--surface)",
                  color: selected?.id === t.id ? "var(--surface)" : "var(--text-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "10px 12px",
                  marginBottom: "8px",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--text-sm)" }}>
                    {activeAction === `tournament-select-${t.id}` ? "Loading..." : t.name}
                  </span>
                  <StatusPill status={t.status} />
                </div>
                <div style={{ color: selected?.id === t.id ? "var(--text-muted)" : "var(--text-secondary)", fontSize: "var(--text-xs)", marginTop: "4px" }}>
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
            <div style={{ color: "var(--text-muted)", padding: "36px", textAlign: "center" }}>
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
                  <button className="btn btn-warning-sm" onClick={handleClose} disabled={!!activeAction}>
                    {activeAction === "tournament-close" ? "Closing..." : "Close"}
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
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    padding: "12px",
                    background: "var(--surface)",
                  }}
                >
                  <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", marginBottom: "4px" }}>
                    {label}
                  </div>
                  <div style={{ color: "var(--text-primary)", fontWeight: "var(--weight-bold)" }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: "14px", overflowX: "auto", paddingBottom: "8px" }}>
              {rounds.map(([roundNo, matches]) => (
                <div key={roundNo} style={{ minWidth: "260px" }}>
                  <div
                    style={{
                      fontSize: "var(--text-sm)",
                      textTransform: "uppercase",
                      color: "var(--text-secondary)",
                      fontWeight: "var(--weight-bold)",
                      marginBottom: "10px",
                    }}
                  >
                    Round {roundNo}
                  </div>
                  {matches.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        padding: "10px",
                        marginBottom: "10px",
                        background: m.status === "completed" ? "var(--surface-muted)" : "var(--surface)",
                      }}
                    >
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: "8px" }}>
                        Match {m.match_no}
                      </div>
                      {[m.player1, m.player2].filter(Boolean).map((p) => {
                        const won = m.winner === p;
                        return (
                          <button
                            key={p}
                            disabled={!!activeAction || m.status === "completed" || selected.status === "completed"}
                            onClick={() => handleWinner(m, p)}
                            style={{
                              width: "100%",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              border: won ? "1px solid color-mix(in srgb, var(--success) 28%, var(--border))" : "1px solid var(--border)",
                              background: won ? "var(--success-bg)" : "var(--surface)",
                              color: won ? "var(--success)" : "var(--text-primary)",
                              borderRadius: "var(--radius-sm)",
                              padding: "8px 10px",
                              marginBottom: "6px",
                              cursor: activeAction ? "wait" : m.status === "completed" ? "default" : "pointer",
                              fontWeight: won ? 700 : 500,
                            }}
                          >
                            <span>{p}</span>
                            <span style={{ fontSize: "var(--text-xs)", color: won ? "var(--success)" : "var(--text-muted)" }}>
                              {activeAction === `winner-${m.id}-${p}` ? "Saving..." : won ? "Winner" : m.status === "completed" ? "" : "Pick"}
                            </span>
                          </button>
                        );
                      })}
                      {!m.player2 && (
                        <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", padding: "4px 2px" }}>
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
