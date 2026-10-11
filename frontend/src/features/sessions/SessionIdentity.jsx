import { CalendarDays, BadgeCheck } from "lucide-react";

export default function SessionIdentity({ session, fallback = "Guest" }) {
  return <span className="session-customer-identity">
    <span className={!session?.customer_name ? "session-anonymous" : undefined}>{session?.customer_name || fallback}</span>
    {session?.player_type === "member" && <span className="session-source-label"><BadgeCheck size={14} aria-hidden="true" />Member</span>}
    {session?.player_type === "booking" && <span className="session-source-label"><CalendarDays size={14} aria-hidden="true" />Booking</span>}
  </span>;
}
