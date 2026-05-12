# `cow-erc20-onchain-order-indexer`

Long-running Node daemon that listens for `OrderPlacement` events emitted by the
[`CoWSwapErc20Flow`](https://github.com/shoom3301/cow-erc20-onchain-order) contract
on Sepolia and posts each as an EIP-1271 order to the CoW Protocol orderbook.

See `docs/superpowers/specs/2026-05-12-erc20-flow-indexer-design.md` for the design.

## Setup

```sh
nvm use         # picks up .nvmrc → Node 20
npm install
cp .env.example .env
# edit .env if you need to override defaults
```

## Run

```sh
npm start       # dev: tsx src/main.ts
npm test        # unit tests
npm run build && npm run start:prod  # production
```

## Environment

| Var | Default | Purpose |
|-----|---------|---------|
| `RPC_WS_URL`    | *(required)* | viem WebSocket transport |
| `RPC_HTTP_URL`  | *(required)* | viem HTTP transport for `eth_getLogs` backfill |
| `FLOW_ADDRESS`  | `0x55cbada3...` | Deployed `CoWSwapErc20Flow` |
| `CHAIN_ID`      | `11155111` | Sepolia |
| `DEPLOY_BLOCK`  | `10838355` | First block to consider on a fresh cursor |
| `CONFIRMATIONS` | `12` | Confirmation depth before posting |
| `CHUNK_SIZE`    | `1000` | Blocks per `getLogs` batch during backfill |
| `STATE_FILE`    | `./state/cursor.json` | Cursor file path |
| `COW_API_URL`   | `https://api.cow.fi/sepolia` | Orderbook base URL |

## Troubleshooting

- **`createOrder` tx reverted with "allowance"?** The user must approve the flow contract on the sellToken first. See the contract repo's readme.
- **Indexer keeps reposting on restart?** Check `STATE_FILE` — if missing or pointing somewhere else each run, the cursor resets to `DEPLOY_BLOCK` every time.
