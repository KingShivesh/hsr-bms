const TONE_ICONS = {
  available: "ti-circle",
  running: "ti-player-play",
  occupied: "ti-player-play",
  paused: "ti-player-pause",
  reserved: "ti-calendar-event",
  maintenance: "ti-tool",
  success: "ti-check",
  warning: "ti-alert-triangle",
  danger: "ti-alert-circle",
  neutral: "ti-circle",
  pending: "ti-clock",
  paid: "ti-receipt",
  cancelled: "ti-x",
  completed: "ti-circle-check",
};

export default function Badge({
  children,
  tone = "neutral",
  icon,
  dot = false,
  className = "",
  title,
  ...props
}) {
  const classes = ["ui-badge", `ui-badge-${tone}`, className].filter(Boolean).join(" ");
  const iconName = icon || TONE_ICONS[tone] || TONE_ICONS.neutral;

  return (
    <span className={classes} title={title || (typeof children === "string" ? children : undefined)} {...props}>
      {dot ? <span className="ui-badge-dot" aria-hidden="true" /> : <i className={`ti ${iconName}`} aria-hidden="true" />}
      <span>{children}</span>
    </span>
  );
}
