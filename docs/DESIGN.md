# Design decisions and trade-offs

## Confirmations

`64` on both chains today. Confirmations reduce reorg risk at the cost of lag. The revalidation pass repairs reorgs inside the configured window. The value is configured per chain in `ChainConfig`.

## Bounded reorg revalidation

Each scanner run re-fetches canonical events for the last `reorgWindow` blocks (default 64) and reconciles against stored rows: upsert canonical first, then delete stale rows whose `(txHash, logIndex)` is no longer present. The cursor is not rewound on success.

This catches reorgs within the window, including events that newly appear in previously-empty blocks. Deeper reorgs need manual reconciliation against archive data.

## Fees as decimal strings

`integratorFee` and `lifiFee` are stored as decimal strings, lossless across MongoDB's BSON boundary. Range queries on fees are not in scope.

## Native asset is a valid event class

`token = 0x0000...0000` is emitted by `collectNativeFees()`. It is not filtered or special-cased.

## Filtered queries reuse the integrator index

`chainId`, `contractAddress`, and `token` predicates are applied after the integrator seek on `{ integrator: 1, blockNumber: -1, logIndex: -1 }`. Targeted compound indexes can be added when profiling shows they are needed.

## No `total` in pagination

`countDocuments` is expensive at scale and is not needed for current query patterns.

## Scanner scaling model

Single-worker per `(chainId, contractAddress)` by design. Horizontal scale comes from running one scanner per chain (`scanner-polygon`, `scanner-ethereum`, `scanner-arbitrum`, `scanner-optimism`).

Parallel scanning within one chain would need persisted block-range jobs, worker leases, retries, and a contiguous checkpointer before advancing `scan_state`. The current single-worker model is sufficient until backlog becomes a bottleneck.

## Write concern

The scanner uses MongoDB's default acknowledged writes (`w: 1`). This is acceptable for a replayable cache. Deployments that need stronger durability can run a replica set and use majority writes.

## Boundary

This service is a derived cache of chain data, not an authoritative settlement ledger. Payouts, disputes, and audits need independent reconciliation against chain or archive data. It is intended for internal or private-network deployment, with no authentication, TLS, or rate-limiting built in. Secrets in `MONGODB_URI` and RPC URLs stay out of logs and commits.

## Out of scope

- **Reorg rewind beyond `reorgWindow`.** Deeper reorgs require a larger window or out-of-band reconciliation against an independent archive node.
- **Authentication, authorization, rate limiting.** Behind a private API gateway in production.
- **Prometheus or OpenTelemetry metrics.** Logs cover current observability needs.
- **Multi-RPC failover or round-robin.** Single provider per process is sufficient now.
- **`blockTimestamp` per event.** Adds extra RPC reads. Add it if consumers need event time.
- **WebSocket subscription for live tail.** The scanner is poll-based via cron or the one-shot CLI.
- **Decimal128 migration for fees.** String storage is lossless.
- **Multi-instance scanner coordination on the same chain.** The design assumes exactly one scanner process per `(chainId, contractAddress)` at a time. Cron or Kubernetes `concurrencyPolicy: Forbid` covers the realistic deployment shape.
