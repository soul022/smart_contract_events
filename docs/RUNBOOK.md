# Runbook

This service is a replayable cache of LI.FI `FeesCollected` events. The scanner runs on a schedule, advances `scan_state`, and repairs recent reorgs within `reorgWindow`.

## Quick checks

```bash
curl -s http://localhost:3000/health
npm run scan -- --chain polygon
npm run scan -- --chain ethereum
```

Expected state:

- `mongo` is `connected`.
- Each expected `(chainId, contractAddress)` has a scan row.
- `ageSeconds` is within the expected scanner cadence. It is driven by `lastRunAt`, so a healthy idle chain at safeTip still reports a fresh heartbeat even when `lastScannedBlock` does not change between runs.
- Scanner logs have no repeated RPC, MongoDB, or reorg deletion warnings.

## Scanner lag is growing

Useful signals:

- Stale chain row in `/health`.
- High `scanner_progress.scanLagBlocks`.
- Repeated RPC errors in scanner logs.
- MongoDB connectivity or disk-space errors.

Recovery actions:

- Run the scanner once for the affected chain.
- Lower `chunkSize` in `src/chains.ts` if failures are range or payload-size related.
- Use a stronger archive RPC if the provider is slow, pruned, or rate-limited.

## Scanner fails repeatedly

Useful signals:

- First error in the failed run.
- Range-related RPC errors.
- `history pruned` responses from the provider.
- MongoDB write failures.

Recovery actions:

- Range errors are handled by adaptive chunk halving. Repeated range failures usually mean `chunkSize` is still too large for that provider.
- `history pruned` errors require an archive-capable RPC.
- MongoDB write failures leave `scan_state` unchanged, so the next run retries the same chunk after the write issue is fixed.

## API 5xx rate increases

Useful signals:

- API logs with `INTERNAL_ERROR` and `requestId`.
- `/health` status.
- MongoDB connection state.
- Query shape, especially large offsets or broad filters.

Recovery actions:

- Restore MongoDB connectivity if `/health` is degraded.
- Use narrower filters or smaller offsets for expensive queries.
- Use `requestId` to trace the failing request in API logs.

## MongoDB is unavailable

Expected behavior:

- `/health` returns `503` with `mongo: "disconnected"`.
- Scanner run exits non-zero.
- The next scheduled scanner run retries from the same cursor because `scan_state` did not advance.

Recovery actions:

- Restore the MongoDB container or host process.
- Resolve disk-space or connection-string issues.
- Restart the API if it does not reconnect cleanly after MongoDB recovers.

## RPC is rate-limiting or down

Expected behavior:

- Transient errors retry with backoff.
- Persistent errors fail the scanner run.
- The next scheduled run retries from the same cursor.

Recovery actions:

- Review provider status and rate limits.
- Use a paid archive-capable RPC if public endpoints are failing.
- Lower `chunkSize` if failures are range or payload-size related.

## Reorg revalidation deletes rows every run

Occasional stale-row deletion is expected after a reorg. Repeated deletion on every run usually points to inconsistent `eth_getLogs` results.

Recovery actions:

- Re-run the scanner once with the same provider and compare deletion logs.
- Cross-check the affected block range against an independent archive RPC.
- Pause downstream consumers until reconciliation is complete if provider inconsistency persists.

## Empty API response for a populated database

Common causes:

- The queried `integrator` is not present in `fee_collected_events`.
- The API is connected to a different database than the scanner.

```bash
curl -s 'http://localhost:3000/events?integrator=<integrator>&limit=5'
```
