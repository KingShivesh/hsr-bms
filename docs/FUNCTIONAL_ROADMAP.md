# Functional build scope

The CueFlow brief is functional guidance, not authorization to replace HSR's
shipped SNOOK palette, Syne/DM Mono fonts, state grammar, or existing stack.

## Included features

| Brief feature | Scope | Current checkpoint |
| --- | --- | --- |
| 1 | Table lifecycle, pause/resume, authoritative billing | Foundation shipped in ecaff80; session-engine-audit evidence |
| 2 | Hourly, per-frame and fixed-package billing | Built and browser-verified; PostgreSQL/release gates recorded in tariff-billing-audit |
| 4 | Member credit limits, append-only ledger, settlement, usage | Planned; external reminders need separate provider configuration |
| 5 | Unified table/cafe bill, menu, kitchen workflow, cafe analytics | Existing session food retained; kitchen lifecycle planned |
| 8 | Revenue/utilization/credit analytics | Existing reporting retained; credit metrics depend on ledger |
| 9 | Admin, manager, counter and kitchen permissions | Existing admin/staff groundwork retained; server permissions and SSE topics must agree |

## Explicitly excluded

- Feature 3: native payment apps and online payment-gateway integration.
- Feature 6: public/branded booking, online booking payments and booking QR codes.
- Feature 7: multiple venues, location switching and aggregate location reporting.
- Feature 10: native iOS/Android applications.

Existing manual Cash/UPI/Card/split recording, internal staff reservations and
responsive web support remain supported. No excluded feature is silently
removed from the existing product. Offline mutation queues are not part of
the first batch; financial conflicts must never use last-write-wins.

## Sequencing and guardrails

Ship one verified batch at a time, with an evidence checkpoint before broad
architectural expansion. Keep the existing shared, metadata-only SSE channel;
do not replace it with a financial/customer-data WebSocket firehose.
Separate whole-app UX and SSE stress/rollout work remain paused.

Before backend merge: fresh dependency install, production-shaped import,
focused session tests and full soak on disposable PostgreSQL. Production
verification is read-only: match the runtime `/health.revision` to the merged
commit and check `/ready`; no production QA mutations without approval.
