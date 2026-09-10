import { useRef } from "react";
import TableCard from "./TableCard.jsx";

export default function TableGrid({
  tables = [],
  selectedTableId = "",
  tick = 0,
  onSelectTable,
  onStartSession,
  onSaveRate,
  onInvalidRate,
}) {
  const gridRef = useRef(null);

  if (!tables.length) {
    return (
      <div className="lf-empty-inline">
        <i className="ti ti-table-off" aria-hidden="true" />
        <span>No tables returned by the backend.</span>
      </div>
    );
  }

  function handleKeyDown(event) {
    const isArrow = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key);
    if (!isArrow) return;

    const grid = gridRef.current;
    if (!grid) return;

    const cards = Array.from(grid.querySelectorAll(".lf-table-card"));
    if (!cards.length) return;

    const activeEl = document.activeElement;
    const activeCard = activeEl?.closest(".lf-table-card");
    const activeIndex = activeCard ? cards.indexOf(activeCard) : -1;

    if (activeIndex === -1) {
      cards[0].focus();
      event.preventDefault();
      return;
    }

    // Group cards into visual rows based on rendered offsetTop
    const rows = [];
    let currentRow = [];
    let currentTop = null;

    cards.forEach((card, idx) => {
      const top = card.offsetTop;
      if (currentTop === null || Math.abs(top - currentTop) < 15) {
        currentRow.push(idx);
        currentTop = top;
      } else {
        rows.push(currentRow);
        currentRow = [idx];
        currentTop = top;
      }
    });
    if (currentRow.length) rows.push(currentRow);

    // Find row index and column index of active card
    let rIdx = -1;
    let cIdx = -1;
    for (let r = 0; r < rows.length; r++) {
      const c = rows[r].indexOf(activeIndex);
      if (c !== -1) {
        rIdx = r;
        cIdx = c;
        break;
      }
    }

    if (rIdx === -1) return;

    let targetIdx = activeIndex;

    if (event.key === "ArrowRight") {
      if (cIdx < rows[rIdx].length - 1) {
        targetIdx = rows[rIdx][cIdx + 1];
      } else if (rIdx < rows.length - 1) {
        targetIdx = rows[rIdx + 1][0];
      }
    } else if (event.key === "ArrowLeft") {
      if (cIdx > 0) {
        targetIdx = rows[rIdx][cIdx - 1];
      } else if (rIdx > 0) {
        targetIdx = rows[rIdx - 1][rows[rIdx - 1].length - 1];
      }
    } else if (event.key === "ArrowDown") {
      if (rIdx < rows.length - 1) {
        const currentCenter = cards[activeIndex].offsetLeft + cards[activeIndex].offsetWidth / 2;
        const nextRow = rows[rIdx + 1];
        let closest = nextRow[0];
        let minDiff = Infinity;
        for (const idx of nextRow) {
          const center = cards[idx].offsetLeft + cards[idx].offsetWidth / 2;
          const diff = Math.abs(center - currentCenter);
          if (diff < minDiff) {
            minDiff = diff;
            closest = idx;
          }
        }
        targetIdx = closest;
      }
    } else if (event.key === "ArrowUp") {
      if (rIdx > 0) {
        const currentCenter = cards[activeIndex].offsetLeft + cards[activeIndex].offsetWidth / 2;
        const prevRow = rows[rIdx - 1];
        let closest = prevRow[0];
        let minDiff = Infinity;
        for (const idx of prevRow) {
          const center = cards[idx].offsetLeft + cards[idx].offsetWidth / 2;
          const diff = Math.abs(center - currentCenter);
          if (diff < minDiff) {
            minDiff = diff;
            closest = idx;
          }
        }
        targetIdx = closest;
      }
    }

    if (targetIdx !== activeIndex && cards[targetIdx]) {
      event.preventDefault();
      cards[targetIdx].focus();
    }
  }

  return (
    <div
      ref={gridRef}
      className="lf-table-grid"
      role="region"
      aria-label="Table cards grid"
      onKeyDown={handleKeyDown}
    >
      {tables.map((table) => (
        <TableCard
          key={table.id}
          table={table}
          selected={selectedTableId === table.id}
          tick={tick}
          onSelect={onSelectTable}
          onStart={onStartSession}
          onSaveRate={onSaveRate}
          onInvalidRate={onInvalidRate}
        />
      ))}
    </div>
  );
}
