# `cow-erc20-onchain-order-indexer` — Onchain → CoW Orderbook indexer

**Status:** Approved 2026-05-12
**Target repo:** `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer` (new, separate from the contract repo)
**Author:** alexandr@cow.fi
**Related:** `2026-05-12-erc20-flow-design.md` (the contract this indexer listens to)

## 1. Goal

A standalone, long-running Node/TypeScript daemon that listens for `OrderPlacement` events emitted by the deployed `CoWSwapErc20Flow` contract on Sepolia (`0x55cbada3d2db7f789a7bc1f2a72f1d487aa30b70`, chain `11155111`) and POSTs each as an EIP-1271 order to the CoW Protocol orderbook (`https://api.cow.fi/sepolia`). Functionally equivalent to CoW's own eth-flow indexer, but for the ERC-20 flow contract.

## 2. Non-goals

- Multi-chain support (Sepolia only for now).
- A REST/GraphQL API in front of the indexer.
- Database-backed persistence (Postgres etc.). Local JSON file is sufficient.
- Reorg detection beyond a configurable confirmation depth.
- Metrics / observability stack (Prometheus, OpenTelemetry).
- Resigning or modifying orders. The indexer is a pass-through.

## 3. Design summary

Single long-running Node process. On startup, the indexer:

1. Loads a local JSON cursor (`{ lastProcessedBlock, processedOrderUids[] }`).
2. **Backfills** missed events by paginated `eth_getLogs` from `lastProcessedBlock + 1` to `currentHead − CONFIRMATIONS`.
3. **Subscribes** to new `OrderPlacement` events via viem `watchContractEvent` on a WebSocket transport.
4. For each event (delayed by `CONFIRMATIONS` blocks), decodes it, builds the corresponding CoW orderbook payload, and posts it via `@cowprotocol/cow-sdk`'s `OrderBookApi`.

Reorgs are tolerated by waiting `CONFIRMATIONS` blocks (default 12 on Sepolia) before posting. Restart-safety comes from the cursor file. Duplicate posts are inherently safe because the CoW orderbook returns 4xx for known orders, and `processedOrderUids[]` in the cursor lets us short-circuit before hitting the API.

Tech stack: TypeScript, Node 20+, [viem](https://viem.sh) for chain interaction, [`@cowprotocol/cow-sdk`](https://github.com/cowprotocol/cow-sdk) for orderbook + orderUid math, vitest for tests, `tsx` for dev runtime, `tsc` for production builds.

## 4. Repo layout

```
cow-erc20-onchain-order-indexer/
├── package.json
├── tsconfig.json
├── .gitignore
├── .env.example
├── readme.md
├── src/
│   ├── config.ts          # env var parsing, defaults, validation
│   ├── abi.ts             # OrderPlacement event ABI (vendored from the contract)
│   ├── client.ts          # viem PublicClient (ws + reconnect/backoff)
│   ├── cursor.ts          # atomic load/save of cursor JSON
│   ├── eventDecoder.ts    # decodeEventLog + parse trailing data blob (quoteId, validTo)
│   ├── orderBuilder.ts    # decoded event → CoW orderbook payload (incl. EIP-1271 signature)
│   ├── cowOrderbook.ts    # OrderBookApi wrapper with retry policy
│   ├── indexer.ts         # backfill + subscribe loop
│   ├── log.ts             # tiny console.log helpers
│   └── main.ts            # entry point + graceful shutdown
└── test/
    ├── eventDecoder.test.ts
    ├── orderBuilder.test.ts
    ├── cursor.test.ts
    └── cowOrderbook.test.ts
```

## 5. Event decoding

### 5.1 `OrderPlacement` topic

From `ICoWSwapOnchainOrders`, verified against the deployed contract's runtime bytecode:

```solidity
event OrderPlacement(
    address indexed sender,
    GPv2Order.Data order,
    OnchainSignature signature,
    bytes data
);

struct GPv2Order.Data {
    address sellToken;
    address buyToken;
    address receiver;
    uint256 sellAmount;
    uint256 buyAmount;
    uint32  validTo;          // the real user-chosen expiry; enforced by settlement
    bytes32 appData;
    uint256 feeAmount;        // always 0
    bytes32 kind;             // KIND_SELL (keccak256("sell"))
    bool    partiallyFillable;
    bytes32 sellTokenBalance; // BALANCE_ERC20 (keccak256("erc20"))
    bytes32 buyTokenBalance;  // BALANCE_ERC20
}

struct OnchainSignature {
    uint8 scheme;             // 0 = Eip1271, 1 = PreSign
    bytes data;               // 20-byte contract address for EIP-1271
}
```

Indexed: only `sender`. All other fields are in the data section. Event topic hash: `0xcf5f9de2984132265203b5c335b25727702ca77262ff622e136baa7362bf1da9`.

### 5.2 The trailing `bytes data` blob

The flow contract encodes `data` as `abi.encodePacked(int64 quoteId)` — 8 bytes:

| Bytes  | Field         | Type   |
|--------|---------------|--------|
| 0..8   | `quoteId`     | int64  |

The order's real expiry now lives in `order.validTo` itself (no longer a sentinel), so no additional trailing field is needed.

`eventDecoder.ts` returns:

```ts
type DecodedOrderPlacement = {
  blockNumber: bigint;
  blockHash:   `0x${string}`;
  txHash:      `0x${string}`;
  logIndex:    number;
  sender:      `0x${string}`;
  order:       GPv2Order;
  signature:   { scheme: 0 | 1; data: `0x${string}` };
  quoteId:     bigint;
};
```

## 6. Orderbook payload

Built from a decoded event:

```ts
{
  sellToken:         order.sellToken,
  buyToken:          order.buyToken,
  receiver:          order.receiver,
  sellAmount:        order.sellAmount.toString(),
  buyAmount:         order.buyAmount.toString(),
  validTo:           order.validTo,                 // real expiry, same as on-chain
  appData:           order.appData,                 // 32-byte hash hex
  feeAmount:         "0",
  kind:              OrderKind.SELL,
  partiallyFillable: order.partiallyFillable,
  sellTokenBalance:  OrderBalance.ERC20,
  buyTokenBalance:   OrderBalance.ERC20,
  signingScheme:     SigningScheme.EIP1271,
  signature:         FLOW_ADDRESS,                  // 20-byte hex = signature payload for EIP-1271
  from:              FLOW_ADDRESS,                  // contract is the order owner
  quoteId:           Number(quoteId),               // int64 → number (CoW quote IDs fit in JS number range comfortably)
}
```

POSTed via `orderBookApi.sendOrder(payload)`.

For the cursor's `processedOrderUids[]`, compute `orderUid` locally via `@cowprotocol/cow-sdk` helpers (e.g. `computeOrderUid` / `OrderUid.from`). If the SDK doesn't expose this directly, fall back to `keccak256(abi.encodePacked(orderDigest, owner, validTo))` via viem primitives — same packing as `GPv2Order.packOrderUidParams` in the contract.

## 7. Indexer loop

```
startup:
  cursor = load(STATE_FILE)               # fall back to { lastProcessedBlock: DEPLOY_BLOCK - 1, processedOrderUids: [] }
  head  = await getBlockNumber()
  target = head - CONFIRMATIONS

  # 1. Backfill in chunks
  for from in [cursor.lastProcessedBlock + 1 .. target] step CHUNK_SIZE:
    to = min(from + CHUNK_SIZE - 1, target)
    logs = await getLogs(flow, OrderPlacement, fromBlock=from, toBlock=to)
    for log in logs (in block + logIndex order):
      handle(log)
    cursor.lastProcessedBlock = to
    save(cursor)

  # 2. Live subscribe
  watchContractEvent({
    address: FLOW_ADDRESS,
    eventName: 'OrderPlacement',
    onLogs: (logs) => for log in logs: queue.push(log),
    onError: backoffReconnect,
  })

  loop forever:
    log = await queue.pop()
    # wait for the confirmation depth to mature
    while currentHead - log.blockNumber < CONFIRMATIONS:
      sleep(BLOCK_TIME)
    handle(log)
    cursor.lastProcessedBlock = max(cursor.lastProcessedBlock, log.blockNumber)
    save(cursor)

handle(log):
  decoded = decode(log)
  orderUid = computeOrderUid(decoded)
  if orderUid in cursor.processedOrderUids:
    return
  payload = build(decoded)
  await postOrder(payload)                # retry policy inside
  cursor.processedOrderUids.push(orderUid)
```

Notes:

- The backfill phase and live phase share the same `handle(log)`. Backfill events are by definition already past `CONFIRMATIONS` so no extra wait.
- `processedOrderUids[]` is bounded by ring buffer (last 10k orderUids) to keep the cursor file small. Restart safety is preserved because `lastProcessedBlock` is the primary cursor; orderUid dedupe is belt-and-suspenders.

## 8. Error handling matrix

| Failure | Action |
|---------|--------|
| WS disconnect / RPC connectivity error | Exponential backoff reconnect (1s → 2s → 4s → cap 60s); cursor untouched |
| `getLogs` / decode failure on a batch | Log error with block range; retry whole batch with shorter chunk size; halt if still failing after 3 attempts |
| `OrderBookApi` 5xx / network error | Retry up to 3× with backoff (500ms, 1s, 2s); if still failing, halt + exit non-zero |
| `OrderBookApi` 4xx (incl. "order already exists") | Log + skip; advance cursor; record orderUid as processed |
| Malformed event data blob (length ≠ 8 bytes) | Log + skip; advance cursor; record orderUid as processed (event is malformed, retrying won't help) |
| Cursor file write fails | Halt + exit non-zero (continuing without persistence is unsafe) |
| `SIGINT` / `SIGTERM` | Stop accepting new events, finish in-flight POST, flush cursor, exit cleanly |

## 9. Configuration (env vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `RPC_WS_URL`    | *(required)* | viem WebSocket transport URL (Sepolia) |
| `RPC_HTTP_URL`  | *(required)* | viem HTTP transport for `getLogs` backfill |
| `FLOW_ADDRESS`  | `0x55cbada3d2db7f789a7bc1f2a72f1d487aa30b70` | Deployed `CoWSwapErc20Flow` |
| `CHAIN_ID`      | `11155111` | Sepolia |
| `DEPLOY_BLOCK`  | `10838355` | First block to consider on a fresh cursor |
| `CONFIRMATIONS` | `12` | Confirmation depth before posting |
| `CHUNK_SIZE`    | `1000` | Blocks per `getLogs` batch during backfill |
| `STATE_FILE`    | `./state/cursor.json` | Cursor file path |
| `COW_API_URL`   | `https://api.cow.fi/sepolia` | Orderbook base URL (overridable for staging) |

## 10. Testing strategy

- **`eventDecoder.test.ts`** — canned raw log fixtures from `cast logs` on the live contract; assert decoded shape and `quoteId` extraction (incl. two's-complement int64).
- **`orderBuilder.test.ts`** — golden-fixture comparison between a decoded event and the produced orderbook payload.
- **`cursor.test.ts`** — round-trip save/load; atomic write (write-temp-then-rename); corrupted file → clean error.
- **`cowOrderbook.test.ts`** — mock `OrderBookApi.sendOrder`; verify retry on 5xx, skip on 4xx, halt on persistent 5xx.
- **No live-network e2e in CI** — would be flaky. A manual `npm run e2e` script can hit Sepolia + CoW staging for hand-verified runs.
- **Framework:** vitest.

## 11. Operator UX

- `.env.example` documenting every env var with sensible Sepolia defaults.
- `npm start` → `tsx src/main.ts` (dev: no build step).
- `npm run build && npm run start:prod` → `dist/main.js` (production).
- `readme.md` with: setup, env table, local-run instructions, docker run snippet, troubleshooting (most common: missing approval before `createOrder`).
- Logging: minimal, human-readable `console.log` with `[timestamp] [level]` prefix.

## 12. Out of scope for this spec

- Bootstrap of the new repo (covered in the implementation plan).
- Docker / CI configuration (initial readme snippet only; production deploy is a follow-up).
- Subgraph or external indexer alternatives.
- Multi-flow-contract / multi-chain support (would require a registry config; future work).
