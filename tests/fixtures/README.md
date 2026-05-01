# Fixtures

## `realPolygonLogs.json`: real on-chain payloads

The 3 records here are verbatim raw `eth_getLogs` responses for `FeesCollected` emissions captured live from Polygon mainnet at the documented `startBlock` window (blocks 78,600,000 to 78,600,050), via `https://polygon.gateway.tenderly.co` (a free archive-capable public gateway).

Each entry preserves the wire-level shape (`topics`, `data`, `blockHash`, `blockNumber`, `logIndex`, `transactionHash`) plus an `_expected` block describing the parsed Mongo row. `tests/unit/realLog.test.ts` pipes each entry through `Interface.parseLog()` (the same path `Contract.queryFilter` uses internally) and asserts the parsed shape matches `_expected`. This locks in the mapping from raw bytes to the DB row.

Coverage notes:

- All 3 events are real, capturing one tiny ERC-20 fee (1500 / 1500 wei), one large ERC-20 fee (~3.76 x 10^18 wei) that exercises BigNumber-as-string losslessness, and one mid-range fee. Two distinct integrators.
- The contract is dormant in recent windows on every chain we can reach via free public RPCs; this 50-block sliver from 2024 is currently the cleanest way to demonstrate the full ingest path.
- To re-capture: pull `eth_getLogs` against `0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9` over a known-active block range from any archive RPC, copy the response array verbatim, and add `_expected` blocks computed from the same data via `parseFeesCollectedLog`.

## `feesCollected.json`: synthetic events for breadth coverage

Synthetic events covering scenarios the real-log fixture does not currently capture:

- Native-asset fee event (`token = 0x0000...0000`) emitted by `collectNativeFees()`. Locks in that the pipeline persists native-fee logs without filtering.
- Cross-chain coverage (`chainId = 137` and `chainId = 1`); the real-log fixture is Polygon-only.

`npm test` replays both files; neither requires RPC or network access.
