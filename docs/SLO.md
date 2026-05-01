# SLOs

These are operating targets for the scanner and API. They are not enforced in code. Alerting belongs in the deployment platform or log backend.

## Scope

This is a private derived cache, not a settlement ledger. Payouts, disputes, and audits need independent reconciliation against chain or archive data.

## Freshness

- Scanner freshness lag stays within 3 scheduled runs for each configured chain.
- With a 10 minute scanner cadence, `/health.scans[].ageSeconds > 1800` is stale.
- `ageSeconds` is driven by `lastRunAt`, which is stamped on every successful run regardless of whether the cursor moved. An idle chain at safeTip still reports a fresh heartbeat, so this signal reflects scanner liveness rather than chain activity.
- Useful signals: `/health.scans[].ageSeconds`, `/health.scans[].lastRunAt`, `scanner_progress.scanLagBlocks`, scanner exit status.

## API availability

- API 5xx rate below 0.1% over a rolling 1 hour window for private/internal traffic.
- Useful signals: request logs with `method`, `path`, `status`, `ms`, `requestId`; `/health` status.

## API latency

- p95 latency below 500 ms for typical filtered `/events` requests.
- Large `offset` queries are excluded from this target because MongoDB `skip` cost grows linearly.
- Useful signals: request log `ms`, query `limit`, query `offset`, and whether `integrator` is highly active.

## Data integrity

- No known divergent rows after bounded reorg revalidation completes.
- Reorgs deeper than `reorgWindow` require manual or scheduled reconciliation against an independent archive RPC.
- Useful signals: reorg revalidation logs, stale-row deletion count, independent archive spot checks.

## Non-goals

- Public Internet availability.
- Settlement-grade finality guarantees.
- Cross-provider consensus.
- USD-denominated fee accounting.
- Auth, TLS, and rate limiting inside this service. Those belong at the private gateway or deployment layer.
