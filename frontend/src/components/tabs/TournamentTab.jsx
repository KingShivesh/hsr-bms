import { Panel as HsrPanel } from "../ui/index.js";
import { formatCurrency as polishCurrency } from "../../utils/format.js";
import { Icon as HsrIcon, Input as HsrInput, Select as HsrSelect, Textarea as HsrTextarea, Button as HsrButton, SkeletonBlock, EmptyState } from "../ui/index.js";
import { useEffect, useMemo, useState } from "react";
import {
  closeTournament,
  createTournament,
  getTableState,
  getTournament,
  getTournaments,
  recordTournamentWinner,
} from "../../api/index.js";
import { HSR_TABLES } from "../../config/hsrTables.js";
import { tableActionNavigation, TABLE_STATUS } from "../../config/tableStatus.js";
import TableStatusCard from "../TableStatusCard.jsx";
import { useToast } from "../toastContext.js";
import { useConfirm } from "../confirmContext.js";
import RetryNotice from "../RetryNotice.jsx";
import { readableFloorSnapshot } from "../../features/live-floor/floorData.js";

const GAME_TYPES = ["8 Ball", "9 Ball", "10 Ball", "Snooker", "Straight Pool"];
const clippedText = { display: "block", minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function recommendedTypeForGame(gameType) {
  return gameType === "Snooker" ? "SNOOKER" : "POOL";
}

function Panel({ title, children, action }) {
  return (
    <HsrPanel as="div" className="settings-panel">
      <div className="settings-panel-header">
        <div className="settings-panel-title" title={title} style={clippedText}>{title}</div>
        {action}
      </div>
      {children}
    </HsrPanel>
  );
}

function StatusPill({ status }) {
  const done = status === "completed";
  return (
    <span className="type-xs polish-padding-0px-8px polish-border-radius-999px polish-font-weight-weight-bold"
      style={{ background: done ? "var(--success-bg)" : "var(--accent-bg)", color: done ? "var(--success)" : "var(--accent)", border: `1px solid ${done ? "color-mix(in srgb, var(--success) 28%, var(--border))" : "color-mix(in srgb, var(--accent) 28%, var(--border))"}` }}
    >
      {done ? "COMPLETED" : status === "active" ? "ACTIVE" : "UNKNOWN"}
    </span>
  );
}

function TournamentTableFloor({ gameType, rates, tableStateById, onNavigate }) {
  const preferredType = recommendedTypeForGame(gameType);

  return (
    <div className="tournament-table-grid">
      {HSR_TABLES.map((table) => {
        const tableState = tableStateById[table.id];
        const session = tableState?.session;
        const occupied = !!session;
        const recommended = table.type === preferredType;
        const detail = occupied
          ? `${session.customer_name || "Guest"} · ₹${Number(session.running_total || 0).toLocaleString("en-IN")} running`
          : recommended
            ? `Best fit for ${gameType}`
            : "Backup table";
        return (
          <TableStatusCard
            key={table.id}
            table={table}
            session={session}
            rates={rates}
            tableState={tableState}
            recommended={recommended}
            recommendedLabel={`Best fit for ${gameType}`}
            detail={detail}
            onAction={() => onNavigate?.(...tableActionNavigation(table.id, tableState?.status_key || "available"))}
          />
        );
      })}
    </div>
  );
}

export default function TournamentTab({ onNavigate }) {
  const { showToast } = useToast();
  const { requestConfirm } = useConfirm();
  const [tournaments, setTournaments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState("Friday Knockout");
  const [gameType, setGameType] = useState("8 Ball");
  const [entryFee, setEntryFee] = useState(0);
  const [playersText, setPlayersText] = useState("");
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState("");
  const [rates, setRates] = useState({ wr: 320, pr: 170, sr: 270 });
  const [tableState, setTableState] = useState([]);
  const [activeAction, setActiveAction] = useState("");
  const [loadError, setLoadError] = useState("");
  const [tableLoadError, setTableLoadError] = useState("");
  const [tableLoading, setTableLoading] = useState(true);

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
      setLoadError("");
      const res = await getTournaments();
      if (!Array.isArray(res.data)) throw new Error("Tournament events unavailable");
      const events = res.data.filter((event) => event && typeof event === "object");
      setTournaments(events);
      const id = nextSelectedId || (events.some((event) => event.id === selected?.id) ? selected.id : events[0]?.id);
      if (id) {
        const detail = await getTournament(id);
        if (!detail.data || typeof detail.data !== "object" || Array.isArray(detail.data)) throw new Error("Tournament detail unavailable");
        setSelected(detail.data);
      } else setSelected(null);
    } catch (e) {
      console.error(e);
      setLoadError(e.userMessage || "Tournaments could not load.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchTableState() {
    try {
      setTableLoadError("");
      const res = await getTableState();
      if (!Array.isArray(res.data?.tables)) throw new Error("Live table status unavailable");
      setTableState(readableFloorSnapshot(res.data).tables);
      setRates(res.data.rates || { wr: 320, pr: 170, sr: 270 });
    } catch (e) {
      console.error(e);
      setTableLoadError(e.userMessage || "Live table status could not load.");
    } finally {
      setTableLoading(false);
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
      if (!res.data || typeof res.data !== "object" || Array.isArray(res.data)) throw new Error("Tournament detail unavailable");
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
    if (!selected) return;
    const confirmed = await requestConfirm({
      title: "Close tournament?",
      message: `Close "${selected.name || "this tournament"}"? This locks the bracket as completed.`,
      confirmLabel: "Close Tournament",
      tone: "warning",
    });
    if (!confirmed) return;
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
    const grouped = Object.create(null);
    (Array.isArray(selected?.matches) ? selected.matches : []).filter(Boolean).forEach((m) => {
      grouped[m.round_no] = grouped[m.round_no] || [];
      grouped[m.round_no].push(m);
    });
    return Object.entries(grouped).sort(([a], [b]) => Number(a) - Number(b));
  }, [selected]);

  const tableStateById = useMemo(() => (
    tableState.reduce((acc, row) => {
      acc[String(row.id || "").toLowerCase()] = row;
      return acc;
    }, Object.create(null))
  ), [tableState]);
  const playerCount = Array.isArray(selected?.players) ? selected.players.filter(Boolean).length : null;
  const tableDataComplete = HSR_TABLES.every((table) => Object.hasOwn(TABLE_STATUS, tableStateById[table.id]?.status_key));

  if (loading) {
    return (
      <div className="page-skeleton compact" role="status" aria-live="polite" aria-label="Loading tournaments">
        <div className="page-skeleton-status">
          <span>Loading tournaments...</span>
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

  return (
    <div className="tournament-layout">
      {loadError && (
        <RetryNotice
          message={loadError}
          detail="Tournament brackets may be stale until this reloads."
          onRetry={() => {
            setLoading(true);
            fetchAll();
          }}
        />
      )}
      <div>
        {flash && (
          <div className="type-sm polish-background-success-bg polish-border-1px-solid-color-mix-in-srgb-success-28-border polish-border-radius-radius-sm polish-padding-8px-12px polish-color-success polish-font-weight-weight-semibold polish-margin-bottom-12px"

          >
            {flash}
          </div>
        )}

        <Panel title="Create Tournament">
          <label className="form-label" htmlFor="tournament-name">Name</label>
          <HsrInput
            id="tournament-name"
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="form-label" htmlFor="tournament-game">Game</label>
          <HsrSelect
            id="tournament-game"
            className="input-field"
            value={gameType}
            onChange={(e) => setGameType(e.target.value)}
          >
            {GAME_TYPES.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </HsrSelect>
          <label className="form-label" htmlFor="tournament-entry-fee">Entry Fee</label>
          <HsrInput
            id="tournament-entry-fee"
            type="number"
            className="input-field"
            value={entryFee}
            onChange={(e) => setEntryFee(e.target.value)}
          />
          <label className="form-label" htmlFor="tournament-players">Players</label>
          <HsrTextarea
            id="tournament-players"
            className="input-field polish-resize-vertical"
            rows={7}
            placeholder={"One player per line\nRahul\nArjun\nVikram"}
            value={playersText}
            onChange={(e) => setPlayersText(e.target.value)}

          />
          <HsrButton native type="button" className="btn btn-primary-sm" onClick={handleCreate} disabled={!!activeAction}>
            {activeAction === "tournament-create" ? "Creating..." : "Create Bracket"}
          </HsrButton>
        </Panel>

        <Panel title="Events">
          {tournaments.length === 0 ? (
            loadError ? <RetryNotice message="Tournament events are unavailable." onRetry={() => fetchAll()} /> : <EmptyState icon="ti-trophy" title="No tournaments yet" description="No tournament matches are scheduled." action={<HsrButton icon="ti-plus" onClick={() => document.getElementById("tournament-name")?.focus()}>New tournament</HsrButton>} />
          ) : (
            tournaments.map((t) => (
              <HsrButton native
                key={t.id}
                onClick={() => handleSelect(t.id)}
                disabled={!!activeAction || t.id == null}
                loading={activeAction === `tournament-select-${t.id}`}
                className="polish-width-100 polish-text-align-left polish-border-radius-radius-sm polish-padding-8px-12px polish-margin-bottom-8px polish-cursor-pointer" style={{ background: selected?.id === t.id ? "var(--accent)" : "var(--surface)", color: selected?.id === t.id ? "var(--text-on-accent)" : "var(--text-primary)", border: selected?.id === t.id ? "1px solid var(--accent-border)" : "1px solid var(--border)" }}
              >
                <div className="polish-display-flex polish-justify-content-space-between" >
                  <span className="type-sm polish-font-weight-weight-bold" title={t.name || "Unnamed tournament"} style={clippedText}>
                    {activeAction === `tournament-select-${t.id}` ? "Loading..." : t.name || "Unnamed tournament"}
                  </span>
                  <StatusPill status={t.status} />
                </div>
                <div className="type-xs polish-margin-top-4px" style={{ color: selected?.id === t.id ? "var(--text-on-accent)" : "var(--text-secondary)" }}>
                  {t.game_type || "—"} · {t.entry_fee == null ? "—" : polishCurrency(t.entry_fee)}
                </div>
              </HsrButton>
            ))
          )}
        </Panel>
      </div>

      <div>
        <Panel title="Tournament Table Floor">
          <div className="tournament-floor-note">
            Live table status uses the HSR setup: T1/T2 Wiraka, T3/T4 English, T5 Pool.
          </div>
          {tableLoading ? <SkeletonBlock label="Loading live table status" rows={3} /> : tableLoadError || !tableDataComplete ? <RetryNotice message={tableLoadError || "Some live table statuses are unavailable"} detail="Reload before choosing a tournament table." onRetry={fetchTableState} /> : <TournamentTableFloor
            gameType={selected?.game_type || gameType}
            rates={rates}
            tableStateById={tableStateById}
            onNavigate={onNavigate}
          />}
        </Panel>

        {!selected ? (
          <Panel title="Bracket">
            {loadError ? <RetryNotice message="Tournament bracket is unavailable." onRetry={() => fetchAll()} /> : <EmptyState icon="ti-trophy" title="No bracket selected" description="There are no matches in this view." action={<HsrButton onClick={() => document.getElementById("tournament-name")?.focus()}>New tournament</HsrButton>} />}
          </Panel>
        ) : (
          <Panel
            title={selected.name || "Tournament"}
            action={
              <div className="polish-display-flex polish-gap-8px polish-align-items-center" >
                <StatusPill status={selected.status} />
                {selected.status === "active" && (
                  <HsrButton native type="button" className="btn btn-warning-sm" onClick={handleClose} disabled={!!activeAction || selected.id == null} loading={activeAction === "tournament-close"}>
                    {activeAction === "tournament-close" ? "Closing..." : "Close Tournament"}
                  </HsrButton>
                )}
              </div>
            }
          >
            <div
              className="polish-display-grid polish-grid-template-columns-repeat-4-1fr polish-gap-12px polish-margin-bottom-16px"
            >
              {[
                ["Game", selected.game_type || "—"],
                ["Players", playerCount ?? "—"],
                ["Pot", playerCount === null || selected.entry_fee == null ? "—" : polishCurrency(selected.entry_fee * playerCount)],
                ["Winner", selected.winner_name || "—"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="polish-border-1px-solid-border polish-border-radius-radius-sm polish-padding-12px polish-background-surface"
                >
                  <div className="type-xs polish-color-text-secondary polish-margin-bottom-4px" >
                    {label}
                  </div>
                  <div className="polish-color-text-primary polish-font-weight-weight-bold" title={String(value ?? "")} style={clippedText}>{value}</div>
                </div>
              ))}
            </div>

            {!rounds.length && <EmptyState icon="ti-trophy" title={Array.isArray(selected.matches) ? "No matches yet" : "Bracket unavailable"} description={Array.isArray(selected.matches) ? "This tournament has no recorded matches." : "Reload the selected tournament to recover its bracket."} action={!Array.isArray(selected.matches) ? <HsrButton onClick={() => handleSelect(selected.id)} disabled={selected.id == null || !!activeAction}>Reload bracket</HsrButton> : undefined} />}
            <div className="polish-display-flex polish-gap-12px polish-overflow-x-auto polish-padding-bottom-8px" >
              {rounds.map(([roundNo, matches]) => (
                <div key={roundNo} className="polish-min-width-260px" style={{ width: 260, flexShrink: 0 }}>
                  <div className="type-sm polish-text-transform-uppercase polish-color-text-secondary polish-font-weight-weight-bold polish-margin-bottom-8px"

                  >
                    Round {roundNo}
                  </div>
                  {matches.map((m) => (
                    <div
                      key={m.id}
                      className="polish-border-1px-solid-border polish-border-radius-radius-sm polish-padding-8px polish-margin-bottom-8px" style={{ background: m.status === "completed" ? "var(--surface-muted)" : "var(--surface)" }}
                    >
                      <div className="type-xs polish-color-text-muted polish-margin-bottom-8px" >
                        Match {m.match_no}
                      </div>
                      {[m.player1, m.player2].filter(Boolean).map((p) => {
                        const won = m.winner === p;
                        return (
                          <HsrButton native
                            key={p}
                            disabled={!!activeAction || m.status === "completed" || selected.status !== "active" || m.id == null || selected.id == null}
                            loading={activeAction === `winner-${m.id}-${p}`}
                            onClick={() => handleWinner(m, p)}
                            className="polish-width-100 polish-display-flex polish-justify-content-space-between polish-align-items-center polish-border-radius-radius-sm polish-padding-8px-8px polish-margin-bottom-4px" style={{ border: won ? "1px solid color-mix(in srgb, var(--success) 28%, var(--border))" : "1px solid var(--border)", background: won ? "var(--success-bg)" : "var(--surface)", color: won ? "var(--success)" : "var(--text-primary)", cursor: activeAction ? "wait" : m.status === "completed" ? "default" : "pointer", fontWeight: won ? "var(--weight-semibold)" : "var(--weight-medium)" }}
                          >
                            <span title={p} style={clippedText}>{p}</span>
                            <span className="type-xs" style={{
  color: won ? "var(--success)" : "var(--text-muted)"
}}>
                              {activeAction === `winner-${m.id}-${p}` ? "Saving..." : won ? "Winner" : m.status === "completed" ? "" : "Pick"}
                            </span>
                          </HsrButton>
                        );
                      })}
                      {!m.player2 && (
                        <div className="type-sm polish-color-text-muted polish-padding-4px-0px" >
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
