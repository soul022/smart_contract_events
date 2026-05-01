# Scanner internals

The scanner is a one-shot CLI that walks a chain in chunked block ranges, upserts logs to MongoDB, and exits. Continuous updates come from cron, GitHub Actions, or a Kubernetes CronJob.

## Behavior

- **Chunked sequential scan** up to `safeTip = currentBlock - confirmations`. The cursor advances only after `bulkWrite` succeeds, so a crash between fetch and write is recovered safely on the next run by re-scanning the chunk (upserts are no-ops).
- **Adaptive chunk halving** in flight on RPC range-too-large errors, recursing down to a floor of 16 blocks per chunk.
- **Bounded reorg revalidation** at the start of every run: re-fetch canonical events for the last `reorgWindow` blocks, upsert canonical first, then delete stored rows whose `(txHash, logIndex)` is no longer present. The cursor is not rewound on success. The pass observes the cancellation flag at every IO boundary, so SIGTERM during revalidation skips the stale-row delete and exits without leaving Mongo in a state where canonical rows are missing.
- **Retry helper** with exponential backoff and jitter for transient network errors. Immediate fail-fast on revert, 4xx, or range-too-large (range errors are caught upstream by the halving logic). The backoff sleep is interruptible: a cancellation flag set during retry breaks out of the wait and rethrows the most recent transient error rather than serving out the full delay.
- **Cold-start guard**: if `safeTip < startBlock`, the scanner logs a single info line and exits cleanly.
- **Liveness heartbeat**: every successful run stamps `lastRunAt: new Date()` on the row in `scan_state` (without upsert). This is distinct from `lastScannedBlock` and from Mongoose's `updatedAt`, so an idle chain at safeTip still surfaces as fresh in `/health.ageSeconds`. Cancelled runs do not bump the heartbeat.
- **Progress logs**: `info` at start, every 100 chunks (with rate and ETA), and at end with totals. `LOG_LEVEL=debug` adds per-chunk logs.
- **Graceful shutdown**: SIGTERM/SIGINT flips a flag the loop checks between chunks; the in-flight chunk completes before exit. The same flag interrupts retry backoff and is observed by the reorg pre-pass.

## Data model

### `fee_collected_events`

Columns: `chainId`, `txHash`, `logIndex`, `blockNumber`, `blockHash`, `contractAddress`, `token`, `integrator`, `integratorFee` (decimal string), `lifiFee` (decimal string), `createdAt`, `updatedAt`.

Indexes:

1. `{ chainId: 1, txHash: 1, logIndex: 1 }`, unique. The upsert and idempotency key.
2. `{ integrator: 1, blockNumber: -1, logIndex: -1 }` supports the primary REST query and sort prefix. Filtered queries (`chainId`, `contractAddress`, `token`) reuse this index. MongoDB seeks on `integrator`, then applies the remaining predicates in memory.

### `scan_state`

Keyed unique on `{ chainId, contractAddress }`. Fields:

- `lastScannedBlock` (highest fully-processed block, inclusive). Advanced with `$max`, so the cursor only moves forward.
- `lastRunAt` (optional `Date`). Stamped on every successful end-to-end scanner run. Drives `/health.ageSeconds` with a fallback to Mongoose's `updatedAt`.
- `createdAt`, `updatedAt` (Mongoose timestamps).

The row is created on the first cursor advance. `lastRunAt` is `$set` without upsert so a cold-start run with nothing to do does not create a row missing `lastScannedBlock`.

## Debug chunk log example

`LOG_LEVEL=debug`:

```text
[2026-05-01 07:48:55.576 +0530] DEBUG (17749): chunk done
    range: { "from": 23572816, "to": 23573815 }
    eventsFound: 522
    upsertedCount: 522
    alreadyPresentCount: 0
    durationMs: 2396
```

## Module map

```
src/
├── config.ts                # dotenv, frozen typed config, validation
├── chains.ts                # ChainConfig, CHAINS registry, getChain(), parseChainSelector
├── logger.ts                # pino instance (pretty in dev, JSON in prod), URL redaction
├── shutdown.ts              # SIGTERM/SIGINT handler factory and cancellation token
├── retry.ts                 # withRetry, classifyError
├── address.ts               # normalizeAddress(), tryNormalizeAddress()
├── db/
│   ├── connection.ts        # mongoose connect/disconnect with timeouts and pool
│   └── models/
│       ├── FeeCollectedEvent.ts
│       └── ScanState.ts
├── chain/
│   ├── provider.ts          # provider, contract, RPC probe, contract-code check
│   └── feeCollectorAbi.ts   # one-line minimal ABI
├── scanner/
│   ├── fetchEvents.ts       # queryFilter and parsed event shape
│   ├── reorg.ts             # bounded recent-window revalidation
│   ├── resume.ts            # ScanState resume cursor lookup
│   ├── scanner.ts           # chunk, fetch, upsert, advance; halving and progress logs
│   ├── resolveChain.ts      # CLI chain selector parsing
│   └── cli.ts               # entrypoint for `npm run scan`
└── api/
    ├── server.ts            # express app factory
    ├── validation.ts        # parseEventsQuery
    ├── routes/events.ts
    ├── routes/health.ts
    └── cli.ts               # entrypoint for `npm run serve`
```
