# API reference

The Events API is a long-running HTTP server. Default `PORT=3000`. All responses set `Cache-Control: no-store` and carry an `X-Request-Id` header. Caller-supplied request IDs are echoed when valid; invalid or overlong values are replaced with a generated UUID.

## `GET /events`

```
GET /events?integrator=<addr>
            [&chain=<name>]
            [&chainId=<id>]
            [&contractAddress=<addr>]
            [&token=<addr>]
            [&limit=<n>]
            [&offset=<n>]
```

### Parameters

- **`integrator`** (required): checksummed or lowercased EVM address. The zero address is rejected. Invalid input returns `400 INVALID_ADDRESS`.
- **`chain`** (optional): chain name (e.g. `polygon`). Resolves to `chainId` internally.
- **`chainId`** (optional): numeric chain id (e.g. `137`). May be passed instead of or alongside `chain`. If both are passed they must agree, otherwise `400 INVALID_CHAIN`. Unknown name or unknown id also returns `400 INVALID_CHAIN`.
- **`contractAddress`** (optional): scopes to a single deployment. Checksummed or lowercased; the zero address is rejected; invalid returns `400 INVALID_ADDRESS`.
- **`token`** (optional): scopes to fees collected in a single token. Same validation as `contractAddress`, except the zero address is accepted as the native-asset signal (`0x0000…0000`).
- **`limit`**: default `50`, max `100`. Negative or non-integer returns `400 INVALID_PAGINATION`.
- **`offset`**: default `0`. Negative or non-integer returns `400 INVALID_PAGINATION`.
- All scalar parameters reject duplicates (`?chain=polygon&chain=ethereum` returns `400`).

### Default behavior

Without `chain`, `contractAddress`, or `token`, returns matches across all persisted chains. Each row carries its `chainId`.

### Sort order

`blockNumber DESC, logIndex DESC, chainId ASC, txHash ASC`. The last two fields make ordering deterministic when block and log index tie.

- **Mixed-chain caveat**: when results span multiple chains, block numbers are not a globally time-ordered stream. They are only meaningful within a single chain.
- **Pagination caveat**: offset-based pagination is fine for typical query patterns. At very large offsets (10K+), MongoDB `skip` cost grows linearly.

### Curl examples

```bash
# Required filter only: all chains, all contracts, all tokens for one integrator.
curl -s 'http://localhost:3000/events?integrator=0x1111111111111111111111111111111111111111'

# Filter by chain name.
curl -s 'http://localhost:3000/events?integrator=0x1111111111111111111111111111111111111111&chain=polygon'

# Filter by numeric chain id.
curl -s 'http://localhost:3000/events?integrator=0x1111111111111111111111111111111111111111&chainId=137'

# Chain name and id may both be present, but must agree.
curl -s 'http://localhost:3000/events?integrator=0x1111111111111111111111111111111111111111&chain=polygon&chainId=137'

# Filter by FeeCollector contract deployment.
curl -s 'http://localhost:3000/events?integrator=0x1111111111111111111111111111111111111111&contractAddress=0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9'

# Filter by token. The zero address is valid here and represents native-asset fees.
curl -s 'http://localhost:3000/events?integrator=0x1111111111111111111111111111111111111111&token=0x0000000000000000000000000000000000000000'

# Paginate with limit and offset.
curl -s 'http://localhost:3000/events?integrator=0x1111111111111111111111111111111111111111&limit=25&offset=50'

# Combine filters.
curl -s 'http://localhost:3000/events?integrator=0x1111111111111111111111111111111111111111&chain=polygon&contractAddress=0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9&token=0x0000000000000000000000000000000000000000&limit=25&offset=0'
```

### Response shape

```json
{
  "data": [
    {
      "chainId": 137,
      "txHash": "0x...",
      "logIndex": 0,
      "blockNumber": 78600100,
      "blockHash": "0x...",
      "contractAddress": "0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9",
      "token": "0x...",
      "integrator": "0x...",
      "integratorFee": "1000000",
      "lifiFee": "200000"
    }
  ],
  "pagination": { "limit": 50, "offset": 0, "returned": 1 }
}
```

`returned` is `data.length`. There is no `total`. Computing it requires a `countDocuments`, which is expensive at scale and not needed for current query patterns.

## `GET /health`

- Returns `503 { status: "degraded", mongo: "disconnected" }` when `mongoose.connection.readyState !== 1`.
- Otherwise returns `200`:

  ```json
  {
    "status": "ok",
    "mongo": "connected",
    "scans": [
      {
        "chainId": 137,
        "contractAddress": "0x...",
        "lastScannedBlock": 78600123,
        "lastRunAt": "2026-05-01T07:48:55.576Z",
        "updatedAt": "2026-05-01T07:48:55.576Z",
        "ageSeconds": 12
      }
    ]
  }
  ```

`ageSeconds = floor((Date.now() - heartbeat) / 1000)` per row, where `heartbeat` is `lastRunAt` when present and falls back to `updatedAt` otherwise. `lastRunAt` is stamped on every successful end-to-end scanner run, including runs where the cursor did not move (idle chain at safeTip), so `ageSeconds` reflects scanner liveness rather than cursor movement. `lastRunAt` is `null` until the first scanner run completes against this row. Use `ageSeconds` for freshness alerts.

## Error model

```json
{ "error": { "code": "INVALID_ADDRESS", "message": "integrator must be a valid EVM address" } }
```

Codes: `INVALID_ADDRESS`, `INVALID_PAGINATION`, `INVALID_CHAIN`, `INTERNAL_ERROR`.
