import { Button as HsrButton, Icon as HsrIcon } from "./index.js";
export default function Tabs({ tabs = [], value, onChange, label = "Tabs", className = "" }) {
  return (
    <div className={["ui-tabs", className].filter(Boolean).join(" ")} role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <HsrButton native
            key={tab.value}
            type="button"
            className={active ? "is-active" : ""}
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(tab.value)}
          >
            {tab.icon && <HsrIcon className={`ti ${tab.icon}`} aria-hidden="true" />}
            <span>{tab.label}</span>
            {tab.count !== undefined && <em>{tab.count}</em>}
          </HsrButton>
        );
      })}
    </div>
  );
}
