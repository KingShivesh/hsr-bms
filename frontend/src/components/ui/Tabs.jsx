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
            tabIndex={active ? 0 : -1}
            onKeyDown={event => {
              const enabled = tabs.filter(item => !item.disabled);
              const index = enabled.findIndex(item => item.value === tab.value);
              const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 :
                event.key === "ArrowRight" ? (index + 1) % enabled.length : event.key === "ArrowLeft" ? (index - 1 + enabled.length) % enabled.length : -1;
              if (next < 0) return;
              event.preventDefault();
              onChange?.(enabled[next].value);
              event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[tabs.indexOf(enabled[next])]?.focus();
            }}
            disabled={tab.disabled}
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
