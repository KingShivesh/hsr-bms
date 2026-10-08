import { TableStateBadge } from "../../components/TableStateUI.jsx";

export default function TableStatusBadge({ statusKey = "available", label = "" }) {
  return <TableStateBadge statusKey={statusKey} label={label} />;
}
