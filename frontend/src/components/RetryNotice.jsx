import { Icon as HsrIcon } from "./ui/index.js";
import Button from "./ui/Button.jsx";

export default function RetryNotice({
  message = "We couldn't load this view.",
  detail = "Check your connection, then try again.",
  onRetry,
}) {
  return (
    <div className="retry-notice" role="alert">
      <HsrIcon className="ti ti-alert-circle" aria-hidden="true" />
      <div>
        <strong>{message}</strong>
        {detail && <span>{detail}</span>}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" icon="ti-refresh" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
