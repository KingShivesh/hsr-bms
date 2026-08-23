export default function RetryNotice({
  message = "Something could not load.",
  detail = "Check the backend connection and try again.",
  onRetry,
}) {
  return (
    <div className="retry-notice" role="alert">
      <i className="ti ti-alert-circle" aria-hidden="true" />
      <div>
        <strong>{message}</strong>
        {detail && <span>{detail}</span>}
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
