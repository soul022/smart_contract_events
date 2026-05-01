# Adding a new EVM chain

Chain-specific values live in `src/chains.ts`. The scanner, provider, API routes, and models all read from `ChainConfig`. The only chain-name default outside that file is in `src/scanner/resolveChain.ts`.

## Steps

1. **FeeCollector deployment.** Chain-specific addresses can differ.
   - Repo: [`lifinance/contracts/tree/main/deployments`](https://github.com/lifinance/contracts/tree/main/deployments). One JSON file per chain (`polygon.json`, `mainnet.json`, `optimism.json`, etc.) listing every LI.FI contract on that chain along with its address. Pin to a tag or commit for a stable snapshot.
   - Runtime metadata: [`https://li.quest/v1/chains`](https://li.quest/v1/chains) and the [LI.FI metadata API](https://docs.li.fi/li.fi-api/li.fi-api) expose deployment data. Useful when bootstrapping a new chain in CI or deployment automation.
   - Runtime bytecode check via `eth_getCode` confirms a contract exists at the candidate address:

     ```bash
     curl -s -X POST -H 'Content-Type: application/json' \
       --data '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["<FEE_COLLECTOR_ADDRESS>","latest"]}' \
       <RPC_URL>
     ```

     Response check:
     - `"result":"0x"`: no contract at that address on this chain.
     - `"result":"0x6080..."`: a contract is deployed. Cross-check it against the LI.FI deployments repo.

     Foundry one-liner: `cast code <FEE_COLLECTOR_ADDRESS> --rpc-url <RPC_URL>`.

2. **Find the deploy block.** Prefer the deployment transaction in LI.FI's deployments file, then look up that transaction's block in a chain explorer. If the deployment file is incomplete, binary-search `eth_getCode` with historical block tags on an archive RPC (replace `"latest"` with a hex block number, for example `"0x4AF080"`).

3. **Append a `ChainConfig` entry** in `src/chains.ts`:

   ```ts
   {
     chainId: <numeric chain id>,           // e.g. 10 for optimism
     name: '<lowercase identifier>',        // becomes the value of --chain
     rpcEnvVar: '<UPPERCASE>_RPC_URL',      // env var name; not the URL itself
     contractAddress: '0xbd6c...',          // verified above
     startBlock: <deploy block>,            // from step 2
     chunkSize: <int>,                      // request size for eth_getLogs
     confirmations: <int>,                  // latest blocks to skip
     reorgWindow: <int>,                    // typically <= confirmations
     rpcTimeoutMs: 30_000,                  // bound a wedged HTTP RPC call
   }
   ```

4. **RPC env var.** Add the variable named by `rpcEnvVar` to `.env.example` and local `.env` files. The scanner reads `process.env[chain.rpcEnvVar]`; a missing or invalid URL fails startup.

5. **Validation.**

   ```bash
   npm run scan -- --chain <name>
   npm run scan -- --chainId <id>
   curl -s http://localhost:3000/health
   ```

   Both CLI selectors work. If `--chain` and `--chainId` are both passed, they must refer to the same configured chain. The new chain gets its own `ScanState` row keyed on `(chainId, contractAddress)`, and `/health` plus `/events` include it without route or model changes.

## Chain settings

These live in `ChainConfig`, not env vars.

- **`startBlock`**: first block to scan. Older is only wasted work; newer skips events.
- **`chunkSize`**: request size for `eth_getLogs`. Smaller values help with RPCs that reject large ranges.
- **`confirmations`**: latest blocks to skip so the scanner avoids unstable chain tips.
- **`reorgWindow`**: recent scanned blocks to re-check on each run. `<= confirmations` keeps rechecks inside the skipped tip window.
- **`rpcTimeoutMs`**: per-request RPC timeout.
