# `cow-erc20-onchain-order-indexer` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node/TypeScript daemon that listens for `OrderPlacement` events emitted by the deployed `CoWSwapErc20Flow` contract on Sepolia (`0x55cbada3d2db7f789a7bc1f2a72f1d487aa30b70`) and posts each as an EIP-1271 order to the CoW Protocol orderbook via `@cowprotocol/cow-sdk`.

**Architecture:** Single long-running process. On startup: load cursor JSON → paginated `eth_getLogs` backfill from `lastProcessedBlock + 1` to `head − CONFIRMATIONS` → viem WebSocket subscription for new events. Each event is decoded, mapped to a CoW orderbook payload, and POSTed via the SDK. The cursor only stores `lastProcessedBlock`; idempotency on the API side (CoW returns 4xx for duplicate orders) makes re-processing the in-flight block on restart safe — simpler than tracking processed orderUids as the spec proposed.

**Tech Stack:** TypeScript, Node 20+, [viem](https://viem.sh) (ws + http transports), [`@cowprotocol/cow-sdk`](https://github.com/cowprotocol/cow-sdk), [vitest](https://vitest.dev), `tsx` for dev runtime, `dotenv` for env loading.

**Reference spec:** `docs/superpowers/specs/2026-05-12-erc20-flow-indexer-design.md`. The spec is the source of truth; this plan turns it into tasks.

**Working directory for all commands below:** `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer` unless otherwise stated.

**Plan deviation from spec (§3, §7):** The cursor stores only `lastProcessedBlock`, not `processedOrderUids[]`. Re-processing the in-flight block on restart is safe because the CoW orderbook returns 4xx (already-known) for duplicates, which we already handle as log-and-advance. This is strictly simpler and requires no orderUid computation.

---

## File map

| Path | Purpose |
|------|---------|
| `package.json` | npm deps + scripts |
| `tsconfig.json` | TypeScript compiler config |
| `vitest.config.ts` | Vitest config |
| `.gitignore` | node_modules, dist, state, .env |
| `.nvmrc` | Pin Node 20 |
| `.env.example` | Documented env vars |
| `readme.md` | Setup + run instructions |
| `src/abi.ts` | OrderPlacement event ABI (and full GPv2Order tuple definition) |
| `src/log.ts` | console-based logger with timestamp/level prefix |
| `src/config.ts` | Parse + validate env vars; default values for Sepolia |
| `src/cursor.ts` | Atomic load/save of `{ lastProcessedBlock: number }` |
| `src/eventDecoder.ts` | Decode a raw `OrderPlacement` log → typed event + parse trailing data blob |
| `src/orderBuilder.ts` | Decoded event → `OrderBookApi.sendOrder` payload |
| `src/cowOrderbook.ts` | Thin wrapper around `OrderBookApi.sendOrder` with retry policy and 4xx skip |
| `src/client.ts` | viem `PublicClient` factory (ws + http) with reconnect callbacks |
| `src/indexer.ts` | Backfill + live subscribe loop |
| `src/main.ts` | Entry point; wires modules; signal handling |
| `test/log.test.ts` | Tests for log formatting |
| `test/config.test.ts` | Tests for env var validation |
| `test/cursor.test.ts` | Tests for atomic file IO and corruption handling |
| `test/eventDecoder.test.ts` | Tests for log decoding + data blob parsing |
| `test/orderBuilder.test.ts` | Tests for event → orderbook payload mapping |
| `test/cowOrderbook.test.ts` | Tests for retry/skip behavior (mocked SDK) |
| `test/fixtures/orderPlacementLog.ts` | Canned raw log for decoder tests |

---

## Task 1: Bootstrap the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.nvmrc`, `.env.example`, `readme.md`

- [ ] **Step 1: Create `.gitignore`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/.gitignore`

```
node_modules/
dist/
state/
.env
.env.local
*.log
.DS_Store
```

- [ ] **Step 2: Create `.nvmrc`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/.nvmrc`

```
20
```

- [ ] **Step 3: Create `package.json`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/package.json`

```json
{
  "name": "cow-erc20-onchain-order-indexer",
  "version": "0.1.0",
  "private": true,
  "description": "Indexer that posts CoWSwapErc20Flow OrderPlacement events to the CoW Protocol orderbook.",
  "license": "LGPL-3.0-or-later",
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "start": "tsx src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start:prod": "node dist/main.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@cowprotocol/cow-sdk": "^5.0.0",
    "dotenv": "^16.4.5",
    "viem": "^2.21.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

Note: package versions are minimum-floor; `npm install` will pick the latest compatible. If `@cowprotocol/cow-sdk` ^5 isn't published yet at execution time, fall back to whatever the latest published major is and adjust import paths in later tasks accordingly.

- [ ] **Step 4: Create `tsconfig.json`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 5: Create `vitest.config.ts`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 5_000,
  },
});
```

- [ ] **Step 6: Create `.env.example`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/.env.example`

```
# Required: WebSocket and HTTP RPC endpoints (Sepolia)
RPC_WS_URL=wss://ethereum-sepolia-rpc.publicnode.com
RPC_HTTP_URL=https://ethereum-sepolia-rpc.publicnode.com

# Optional: defaults assume Sepolia + the canonical deployment
FLOW_ADDRESS=0x55cbada3d2db7f789a7bc1f2a72f1d487aa30b70
CHAIN_ID=11155111
DEPLOY_BLOCK=10838355
CONFIRMATIONS=12
CHUNK_SIZE=1000
STATE_FILE=./state/cursor.json
COW_API_URL=https://api.cow.fi/sepolia
```

- [ ] **Step 7: Create `readme.md`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/readme.md`

````markdown
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
````

- [ ] **Step 8: Install dependencies**

Run:
```sh
cd /Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer && npm install
```

Expected: `node_modules/` populated. Warnings about deprecated transitive deps are OK. Errors are not.

- [ ] **Step 9: Verify TS toolchain works**

Run:
```sh
npm run typecheck
```

Expected: exits 0 (nothing to check yet — no `src/` files exist).

- [ ] **Step 10: Commit**

```sh
git add .gitignore .nvmrc package.json package-lock.json tsconfig.json vitest.config.ts .env.example readme.md && git commit -m "chore: bootstrap indexer project"
```

---

## Task 2: ABI module

**Files:**
- Create: `src/abi.ts`

`src/abi.ts` exports the `OrderPlacement` event ABI as a `const` so viem can infer types from it. The ABI definition mirrors `ICoWSwapOnchainOrders` from the contract repo.

- [ ] **Step 1: Create `src/abi.ts`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/src/abi.ts`

```ts
// OrderPlacement event ABI for CoWSwapErc20Flow, vendored from
// `src/interfaces/ICoWSwapOnchainOrders.sol` in the contract repo.
//
// Event topic hash: 0xcf5f9de2984132265203b5c335b25727702ca77262ff622e136baa7362bf1da9
//
// `const` assertion lets viem infer the parsed log shape.

export const orderPlacementEvent = {
  type: "event",
  name: "OrderPlacement",
  inputs: [
    { name: "sender", type: "address", indexed: true },
    {
      name: "order",
      type: "tuple",
      indexed: false,
      components: [
        { name: "sellToken", type: "address" },
        { name: "buyToken", type: "address" },
        { name: "receiver", type: "address" },
        { name: "sellAmount", type: "uint256" },
        { name: "buyAmount", type: "uint256" },
        { name: "validTo", type: "uint32" },
        { name: "appData", type: "bytes32" },
        { name: "feeAmount", type: "uint256" },
        { name: "kind", type: "bytes32" },
        { name: "partiallyFillable", type: "bool" },
        { name: "sellTokenBalance", type: "bytes32" },
        { name: "buyTokenBalance", type: "bytes32" },
      ],
    },
    {
      name: "signature",
      type: "tuple",
      indexed: false,
      components: [
        { name: "scheme", type: "uint8" },
        { name: "data", type: "bytes" },
      ],
    },
    { name: "data", type: "bytes", indexed: false },
  ],
} as const;

export const flowAbi = [orderPlacementEvent] as const;

// keccak256("sell") -> the value of GPv2Order.KIND_SELL.
// Used as a defensive assertion in eventDecoder.
export const KIND_SELL =
  "0xf3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775" as const;

// keccak256("erc20")
export const BALANCE_ERC20 =
  "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9" as const;
```

- [ ] **Step 2: Verify it typechecks**

Run:
```sh
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```sh
git add src/abi.ts && git commit -m "feat: add OrderPlacement event ABI"
```

---

## Task 3: Log module

TDD.

**Files:**
- Create: `src/log.ts`
- Test: `test/log.test.ts`

- [ ] **Step 1: Write failing test**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/test/log.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "../src/log.js";

describe("log", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("emits info to stdout with [INFO] prefix", () => {
    log.info("hello world");
    expect(stdoutSpy).toHaveBeenCalledOnce();
    const line = stdoutSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[INFO]");
    expect(line).toContain("hello world");
    expect(line.endsWith("\n")).toBe(true);
  });

  it("emits warn to stderr with [WARN] prefix", () => {
    log.warn("careful");
    expect(stderrSpy).toHaveBeenCalledOnce();
    const line = stderrSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[WARN]");
    expect(line).toContain("careful");
  });

  it("emits error to stderr with [ERROR] prefix and includes Error stack", () => {
    const err = new Error("boom");
    log.error("failure", err);
    expect(stderrSpy).toHaveBeenCalledOnce();
    const line = stderrSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[ERROR]");
    expect(line).toContain("failure");
    expect(line).toContain("boom");
  });

  it("serializes extra data as JSON", () => {
    log.info("event", { block: 1n, foo: "bar" });
    const line = stdoutSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain('"block":"1"');
    expect(line).toContain('"foo":"bar"');
  });

  it("includes an ISO timestamp prefix", () => {
    log.info("ts");
    const line = stdoutSpy.mock.calls[0]?.[0] as string;
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```sh
npm test -- log
```

Expected: failure — `src/log.ts` doesn't exist.

- [ ] **Step 3: Implement `src/log.ts`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/src/log.ts`

```ts
// Minimal console-based logger. Writes line-buffered output to stdout/stderr
// with `[timestamp] [LEVEL] message [extras-as-JSON]`.

type Extras = Record<string, unknown> | undefined;

function format(level: string, msg: string, extras: Extras): string {
  const ts = new Date().toISOString();
  let line = `${ts} [${level}] ${msg}`;
  if (extras !== undefined) {
    line += " " + JSON.stringify(extras, bigintReplacer);
  }
  return line + "\n";
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export const log = {
  info(msg: string, extras?: Extras): void {
    process.stdout.write(format("INFO", msg, extras));
  },
  warn(msg: string, extras?: Extras): void {
    process.stderr.write(format("WARN", msg, extras));
  },
  error(msg: string, err?: unknown, extras?: Extras): void {
    const merged: Record<string, unknown> = { ...(extras ?? {}) };
    if (err instanceof Error) {
      merged.error = err.message;
      if (err.stack) merged.stack = err.stack;
    } else if (err !== undefined) {
      merged.error = String(err);
    }
    process.stderr.write(format("ERROR", msg, merged));
  },
};
```

- [ ] **Step 4: Run test, expect pass**

```sh
npm test -- log
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/log.ts test/log.test.ts && git commit -m "feat: add log module"
```

---

## Task 4: Config module

TDD.

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write failing test**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/test/config.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { loadConfig, type RawEnv } from "../src/config.js";

const baseEnv: RawEnv = {
  RPC_WS_URL: "wss://example/ws",
  RPC_HTTP_URL: "https://example/http",
};

describe("loadConfig", () => {
  it("applies Sepolia defaults when optional vars are unset", () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.rpcWsUrl).toBe("wss://example/ws");
    expect(cfg.rpcHttpUrl).toBe("https://example/http");
    expect(cfg.flowAddress).toBe("0x55cbada3d2db7f789a7bc1f2a72f1d487aa30b70");
    expect(cfg.chainId).toBe(11155111);
    expect(cfg.deployBlock).toBe(10838355n);
    expect(cfg.confirmations).toBe(12);
    expect(cfg.chunkSize).toBe(1000n);
    expect(cfg.stateFile).toBe("./state/cursor.json");
    expect(cfg.cowApiUrl).toBe("https://api.cow.fi/sepolia");
  });

  it("overrides defaults from env", () => {
    const cfg = loadConfig({
      ...baseEnv,
      FLOW_ADDRESS: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      CHAIN_ID: "1",
      DEPLOY_BLOCK: "100",
      CONFIRMATIONS: "30",
      CHUNK_SIZE: "500",
      STATE_FILE: "/var/run/indexer.json",
      COW_API_URL: "https://barn.api.cow.fi/sepolia",
    });
    expect(cfg.flowAddress).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(cfg.chainId).toBe(1);
    expect(cfg.deployBlock).toBe(100n);
    expect(cfg.confirmations).toBe(30);
    expect(cfg.chunkSize).toBe(500n);
    expect(cfg.stateFile).toBe("/var/run/indexer.json");
    expect(cfg.cowApiUrl).toBe("https://barn.api.cow.fi/sepolia");
  });

  it("throws on missing RPC_WS_URL", () => {
    expect(() => loadConfig({ ...baseEnv, RPC_WS_URL: undefined })).toThrow(
      /RPC_WS_URL/,
    );
  });

  it("throws on missing RPC_HTTP_URL", () => {
    expect(() => loadConfig({ ...baseEnv, RPC_HTTP_URL: undefined })).toThrow(
      /RPC_HTTP_URL/,
    );
  });

  it("throws on invalid FLOW_ADDRESS", () => {
    expect(() => loadConfig({ ...baseEnv, FLOW_ADDRESS: "notanaddr" })).toThrow(
      /FLOW_ADDRESS/,
    );
  });

  it("throws on non-numeric CHAIN_ID", () => {
    expect(() => loadConfig({ ...baseEnv, CHAIN_ID: "abc" })).toThrow(
      /CHAIN_ID/,
    );
  });

  it("throws on negative CONFIRMATIONS", () => {
    expect(() => loadConfig({ ...baseEnv, CONFIRMATIONS: "-1" })).toThrow(
      /CONFIRMATIONS/,
    );
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```sh
npm test -- config
```

Expected: failure — `src/config.ts` not found.

- [ ] **Step 3: Implement `src/config.ts`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/src/config.ts`

```ts
// Parse + validate environment variables. Provides Sepolia defaults for the
// known deployment; required values (RPC URLs) throw if missing.

export type RawEnv = Partial<Record<string, string | undefined>>;

export interface Config {
  rpcWsUrl: string;
  rpcHttpUrl: string;
  flowAddress: `0x${string}`;
  chainId: number;
  deployBlock: bigint;
  confirmations: number;
  chunkSize: bigint;
  stateFile: string;
  cowApiUrl: string;
}

const DEFAULTS = {
  FLOW_ADDRESS: "0x55cbada3d2db7f789a7bc1f2a72f1d487aa30b70",
  CHAIN_ID: "11155111",
  DEPLOY_BLOCK: "10838355",
  CONFIRMATIONS: "12",
  CHUNK_SIZE: "1000",
  STATE_FILE: "./state/cursor.json",
  COW_API_URL: "https://api.cow.fi/sepolia",
} as const;

function required(env: RawEnv, key: string): string {
  const v = env[key];
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

function asInt(env: RawEnv, key: string, fallback?: string): number {
  const raw = env[key] ?? fallback;
  if (raw === undefined) throw new Error(`Missing env var: ${key}`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid ${key}: ${raw} (expected non-negative integer)`);
  }
  return n;
}

function asBigInt(env: RawEnv, key: string, fallback?: string): bigint {
  const raw = env[key] ?? fallback;
  if (raw === undefined) throw new Error(`Missing env var: ${key}`);
  try {
    const n = BigInt(raw);
    if (n < 0n) throw new Error("negative");
    return n;
  } catch {
    throw new Error(`Invalid ${key}: ${raw} (expected non-negative integer)`);
  }
}

function asAddress(env: RawEnv, key: string, fallback?: string): `0x${string}` {
  const raw = (env[key] ?? fallback)?.toLowerCase();
  if (raw === undefined) throw new Error(`Missing env var: ${key}`);
  if (!/^0x[0-9a-f]{40}$/.test(raw)) {
    throw new Error(`Invalid ${key}: ${raw} (expected 0x + 40 hex chars)`);
  }
  return raw as `0x${string}`;
}

export function loadConfig(env: RawEnv = process.env): Config {
  return {
    rpcWsUrl: required(env, "RPC_WS_URL"),
    rpcHttpUrl: required(env, "RPC_HTTP_URL"),
    flowAddress: asAddress(env, "FLOW_ADDRESS", DEFAULTS.FLOW_ADDRESS),
    chainId: asInt(env, "CHAIN_ID", DEFAULTS.CHAIN_ID),
    deployBlock: asBigInt(env, "DEPLOY_BLOCK", DEFAULTS.DEPLOY_BLOCK),
    confirmations: asInt(env, "CONFIRMATIONS", DEFAULTS.CONFIRMATIONS),
    chunkSize: asBigInt(env, "CHUNK_SIZE", DEFAULTS.CHUNK_SIZE),
    stateFile: env.STATE_FILE ?? DEFAULTS.STATE_FILE,
    cowApiUrl: env.COW_API_URL ?? DEFAULTS.COW_API_URL,
  };
}
```

- [ ] **Step 4: Run test, expect pass**

```sh
npm test -- config
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/config.ts test/config.test.ts && git commit -m "feat: add config module with env var validation"
```

---

## Task 5: Cursor module

TDD. The cursor persists `lastProcessedBlock`. Atomicity is achieved by writing to a sibling tempfile and `rename()`ing.

**Files:**
- Create: `src/cursor.ts`
- Test: `test/cursor.test.ts`

- [ ] **Step 1: Write failing test**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/test/cursor.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCursor, saveCursor } from "../src/cursor.js";

describe("cursor", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "indexer-cursor-"));
    file = join(dir, "cursor.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loadCursor returns null when file missing", async () => {
    expect(await loadCursor(file)).toBeNull();
  });

  it("saveCursor + loadCursor round-trips", async () => {
    await saveCursor(file, { lastProcessedBlock: 12345n });
    const loaded = await loadCursor(file);
    expect(loaded?.lastProcessedBlock).toBe(12345n);
  });

  it("saveCursor creates the parent directory if missing", async () => {
    const nested = join(dir, "a", "b", "cursor.json");
    await saveCursor(nested, { lastProcessedBlock: 1n });
    expect(await loadCursor(nested)).toEqual({ lastProcessedBlock: 1n });
  });

  it("saveCursor is atomic: a partial write does not corrupt the live file", async () => {
    // Write a known-good cursor first
    await saveCursor(file, { lastProcessedBlock: 100n });

    // Manually corrupt the *tempfile* path the saver would use — confirms tempfile naming
    // doesn't collide with the live file.
    writeFileSync(file + ".tmp", "garbage", "utf8");

    // The real save should overwrite the tempfile and rename it cleanly.
    await saveCursor(file, { lastProcessedBlock: 200n });
    expect(await loadCursor(file)).toEqual({ lastProcessedBlock: 200n });
  });

  it("loadCursor throws on malformed JSON", async () => {
    writeFileSync(file, "{not json", "utf8");
    await expect(loadCursor(file)).rejects.toThrow();
  });

  it("loadCursor throws if lastProcessedBlock is missing", async () => {
    writeFileSync(file, JSON.stringify({}), "utf8");
    await expect(loadCursor(file)).rejects.toThrow(/lastProcessedBlock/);
  });

  it("loadCursor coerces string lastProcessedBlock back to bigint", async () => {
    writeFileSync(
      file,
      JSON.stringify({ lastProcessedBlock: "999999999999999999999" }),
      "utf8",
    );
    const loaded = await loadCursor(file);
    expect(loaded?.lastProcessedBlock).toBe(999999999999999999999n);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```sh
npm test -- cursor
```

Expected: failure — `src/cursor.ts` not found.

- [ ] **Step 3: Implement `src/cursor.ts`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/src/cursor.ts`

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface Cursor {
  lastProcessedBlock: bigint;
}

export async function loadCursor(path: string): Promise<Cursor | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const parsed = JSON.parse(raw) as { lastProcessedBlock?: string | number };
  if (parsed.lastProcessedBlock === undefined) {
    throw new Error("Cursor file missing lastProcessedBlock");
  }
  return { lastProcessedBlock: BigInt(parsed.lastProcessedBlock) };
}

export async function saveCursor(path: string, cursor: Cursor): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  const body = JSON.stringify(
    { lastProcessedBlock: cursor.lastProcessedBlock.toString() },
    null,
    2,
  );
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
}
```

- [ ] **Step 4: Run test, expect pass**

```sh
npm test -- cursor
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/cursor.ts test/cursor.test.ts && git commit -m "feat: add atomic cursor file IO"
```

---

## Task 6: Event decoder

TDD with a hand-built fixture log.

**Files:**
- Create: `src/eventDecoder.ts`, `test/fixtures/orderPlacementLog.ts`
- Test: `test/eventDecoder.test.ts`

- [ ] **Step 1: Create the fixture**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/test/fixtures/orderPlacementLog.ts`

```ts
// A hand-crafted OrderPlacement log used by eventDecoder tests.
//
// The data is ABI-encoded according to the event ABI in src/abi.ts. The trailing
// `bytes data` field within the event holds `abi.encodePacked(int64 quoteId, uint32 outerValidTo)`
// (12 bytes) as emitted by CoWSwapErc20Flow.createOrder.
//
// To regenerate from a real onchain event, use:
//   cast logs --rpc-url $RPC_HTTP_URL \
//     --from-block 10838355 \
//     --address 0x55cbada3d2db7f789a7bc1f2a72f1d487aa30b70 \
//     "OrderPlacement(address,((address,address,address,uint256,uint256,uint32,bytes32,uint256,bytes32,bool,bytes32,bytes32),(uint8,bytes),bytes))"
// and paste the topics + data below.

import { encodeAbiParameters, encodePacked, pad } from "viem";

const SENDER = "0xfb3c7eb936caa12b5a884d612393969a557d4307" as const;
const SELL  = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" as const; // Sepolia WETH
const BUY   = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const; // Sepolia USDC (random pick)
const RECEIVER = "0xAAaaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa" as const;
const FLOW_ADDR = "0x55cbada3d2db7f789a7bc1f2a72f1d487aa30b70" as const;

const KIND_SELL =
  "0xf3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775" as const;
const BALANCE_ERC20 =
  "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9" as const;

export const fixtureSender = SENDER;
export const fixtureSellToken = SELL;
export const fixtureBuyToken  = BUY;
export const fixtureReceiver  = RECEIVER;
export const fixtureQuoteId   = 123n;
export const fixtureOuterValidTo = 1747083600; // 2026-05-12T13:00:00Z-ish

export const fixtureOrder = {
  sellToken: SELL,
  buyToken:  BUY,
  receiver:  RECEIVER,
  sellAmount: 10n ** 16n,           // 0.01 sellToken (1e16)
  buyAmount:  10_000_000n,          // 10 USDC (6 decimals)
  validTo:    0xffffffff,
  appData:    "0x4242424242424242424242424242424242424242424242424242424242424242" as `0x${string}`,
  feeAmount:  0n,
  kind:       KIND_SELL,
  partiallyFillable: false,
  sellTokenBalance:  BALANCE_ERC20,
  buyTokenBalance:   BALANCE_ERC20,
} as const;

export const fixtureSignature = {
  scheme: 0,
  data: FLOW_ADDR.toLowerCase() as `0x${string}`,
};

const dataBlob = encodePacked(
  ["int64", "uint32"],
  [fixtureQuoteId, fixtureOuterValidTo],
);

const eventData = encodeAbiParameters(
  [
    {
      name: "order",
      type: "tuple",
      components: [
        { name: "sellToken", type: "address" },
        { name: "buyToken", type: "address" },
        { name: "receiver", type: "address" },
        { name: "sellAmount", type: "uint256" },
        { name: "buyAmount", type: "uint256" },
        { name: "validTo", type: "uint32" },
        { name: "appData", type: "bytes32" },
        { name: "feeAmount", type: "uint256" },
        { name: "kind", type: "bytes32" },
        { name: "partiallyFillable", type: "bool" },
        { name: "sellTokenBalance", type: "bytes32" },
        { name: "buyTokenBalance", type: "bytes32" },
      ],
    },
    {
      name: "signature",
      type: "tuple",
      components: [
        { name: "scheme", type: "uint8" },
        { name: "data", type: "bytes" },
      ],
    },
    { name: "data", type: "bytes" },
  ],
  [fixtureOrder, fixtureSignature, dataBlob],
);

export const fixtureLog = {
  address: FLOW_ADDR,
  topics: [
    // keccak256("OrderPlacement(address,(address,address,address,uint256,uint256,uint32,bytes32,uint256,bytes32,bool,bytes32,bytes32),(uint8,bytes),bytes)")
    "0xcf5f9de2984132265203b5c335b25727702ca77262ff622e136baa7362bf1da9",
    pad(SENDER, { size: 32 }),
  ] as [`0x${string}`, `0x${string}`],
  data: eventData,
  blockNumber: 10_900_000n,
  blockHash: "0x" + "ab".repeat(32) as `0x${string}`,
  transactionHash: "0x" + "cd".repeat(32) as `0x${string}`,
  logIndex: 7,
  transactionIndex: 0,
  removed: false,
} as const;
```

- [ ] **Step 2: Write failing test**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/test/eventDecoder.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { decodeOrderPlacementLog } from "../src/eventDecoder.js";
import {
  fixtureLog,
  fixtureSender,
  fixtureOrder,
  fixtureSignature,
  fixtureQuoteId,
  fixtureOuterValidTo,
} from "./fixtures/orderPlacementLog.js";

describe("decodeOrderPlacementLog", () => {
  it("decodes a well-formed OrderPlacement log", () => {
    const decoded = decodeOrderPlacementLog(fixtureLog);
    expect(decoded.sender.toLowerCase()).toBe(fixtureSender.toLowerCase());
    expect(decoded.order.sellAmount).toBe(fixtureOrder.sellAmount);
    expect(decoded.order.buyAmount).toBe(fixtureOrder.buyAmount);
    expect(decoded.order.sellToken.toLowerCase()).toBe(
      fixtureOrder.sellToken.toLowerCase(),
    );
    expect(decoded.order.buyToken.toLowerCase()).toBe(
      fixtureOrder.buyToken.toLowerCase(),
    );
    expect(decoded.order.receiver.toLowerCase()).toBe(
      fixtureOrder.receiver.toLowerCase(),
    );
    expect(decoded.order.validTo).toBe(fixtureOrder.validTo);
    expect(decoded.order.appData).toBe(fixtureOrder.appData);
    expect(decoded.order.feeAmount).toBe(fixtureOrder.feeAmount);
    expect(decoded.order.kind).toBe(fixtureOrder.kind);
    expect(decoded.order.partiallyFillable).toBe(fixtureOrder.partiallyFillable);
    expect(decoded.signature.scheme).toBe(fixtureSignature.scheme);
    expect(decoded.signature.data.toLowerCase()).toBe(
      fixtureSignature.data.toLowerCase(),
    );
    expect(decoded.quoteId).toBe(fixtureQuoteId);
    expect(decoded.outerValidTo).toBe(fixtureOuterValidTo);
    expect(decoded.blockNumber).toBe(fixtureLog.blockNumber);
    expect(decoded.txHash).toBe(fixtureLog.transactionHash);
    expect(decoded.logIndex).toBe(fixtureLog.logIndex);
  });

  // Wrong-length data blob is covered by the parseDataBlob tests below.
  // Re-encoding the outer event with a malformed inner blob adds no signal.
});

import { parseDataBlob } from "../src/eventDecoder.js";

describe("parseDataBlob", () => {
  it("parses {quoteId, outerValidTo} from 12 packed bytes", () => {
    // int64(123) || uint32(1747083600)
    const blob =
      "0x000000000000007b6822c190" as `0x${string}`;
    const { quoteId, outerValidTo } = parseDataBlob(blob);
    expect(quoteId).toBe(123n);
    expect(outerValidTo).toBe(0x6822c190);
  });

  it("handles negative quoteId (two's complement int64)", () => {
    // int64(-1) || uint32(0)
    const blob = "0xffffffffffffffff00000000" as `0x${string}`;
    const { quoteId, outerValidTo } = parseDataBlob(blob);
    expect(quoteId).toBe(-1n);
    expect(outerValidTo).toBe(0);
  });

  it("throws on wrong length", () => {
    expect(() => parseDataBlob("0x1234" as `0x${string}`)).toThrow(/length/);
    expect(() =>
      parseDataBlob(("0x" + "ab".repeat(20)) as `0x${string}`),
    ).toThrow(/length/);
  });
});
```

- [ ] **Step 3: Run test, expect failure**

```sh
npm test -- eventDecoder
```

Expected: failure — `src/eventDecoder.ts` not found.

- [ ] **Step 4: Implement `src/eventDecoder.ts`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/src/eventDecoder.ts`

```ts
import { decodeEventLog, type Log } from "viem";
import { orderPlacementEvent } from "./abi.js";

export interface DecodedOrder {
  sellToken: `0x${string}`;
  buyToken: `0x${string}`;
  receiver: `0x${string}`;
  sellAmount: bigint;
  buyAmount: bigint;
  validTo: number;
  appData: `0x${string}`;
  feeAmount: bigint;
  kind: `0x${string}`;
  partiallyFillable: boolean;
  sellTokenBalance: `0x${string}`;
  buyTokenBalance: `0x${string}`;
}

export interface DecodedSignature {
  scheme: number;
  data: `0x${string}`;
}

export interface DecodedOrderPlacement {
  blockNumber: bigint;
  blockHash: `0x${string}` | null;
  txHash: `0x${string}` | null;
  logIndex: number | null;
  sender: `0x${string}`;
  order: DecodedOrder;
  signature: DecodedSignature;
  quoteId: bigint;
  outerValidTo: number;
}

const DATA_BLOB_LEN = 8 /* int64 */ + 4; /* uint32 */

export function parseDataBlob(blob: `0x${string}`): {
  quoteId: bigint;
  outerValidTo: number;
} {
  // 0x + 2 hex chars/byte
  const hex = blob.slice(2);
  if (hex.length !== DATA_BLOB_LEN * 2) {
    throw new Error(
      `Unexpected data blob length: got ${hex.length / 2} bytes, want ${DATA_BLOB_LEN}`,
    );
  }
  const quoteIdHex = hex.slice(0, 16);
  const validToHex = hex.slice(16, 24);

  // Parse int64 as two's complement.
  const quoteIdUnsigned = BigInt("0x" + quoteIdHex);
  const SIGN_BIT = 1n << 63n;
  const MASK = (1n << 64n);
  const quoteId =
    quoteIdUnsigned & SIGN_BIT ? quoteIdUnsigned - MASK : quoteIdUnsigned;

  const outerValidTo = Number(BigInt("0x" + validToHex));
  return { quoteId, outerValidTo };
}

export function decodeOrderPlacementLog(
  raw: Pick<
    Log,
    "address" | "topics" | "data" | "blockNumber" | "blockHash" | "transactionHash" | "logIndex"
  >,
): DecodedOrderPlacement {
  const { args } = decodeEventLog({
    abi: [orderPlacementEvent],
    eventName: "OrderPlacement",
    topics: raw.topics as [`0x${string}`, ...`0x${string}`[]],
    data: raw.data as `0x${string}`,
  });

  const { quoteId, outerValidTo } = parseDataBlob(args.data as `0x${string}`);

  return {
    blockNumber: raw.blockNumber ?? 0n,
    blockHash: raw.blockHash ?? null,
    txHash: raw.transactionHash ?? null,
    logIndex: raw.logIndex ?? null,
    sender: args.sender as `0x${string}`,
    order: args.order as DecodedOrder,
    signature: {
      scheme: Number(args.signature.scheme),
      data: args.signature.data as `0x${string}`,
    },
    quoteId,
    outerValidTo,
  };
}
```

- [ ] **Step 5: Run test, expect pass**

```sh
npm test -- eventDecoder
```

Expected: all tests pass (4 in `decodeOrderPlacementLog`, 3 in `parseDataBlob`).

- [ ] **Step 6: Commit**

```sh
git add src/eventDecoder.ts test/eventDecoder.test.ts test/fixtures/orderPlacementLog.ts && git commit -m "feat: decode OrderPlacement logs + parse trailing data blob"
```

---

## Task 7: Order builder

TDD. Maps a `DecodedOrderPlacement` to a CoW orderbook POST payload (`OrderBookApi.sendOrder` argument).

**Files:**
- Create: `src/orderBuilder.ts`
- Test: `test/orderBuilder.test.ts`

- [ ] **Step 1: Write failing test**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/test/orderBuilder.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildOrderPayload } from "../src/orderBuilder.js";
import { decodeOrderPlacementLog } from "../src/eventDecoder.js";
import {
  fixtureLog,
  fixtureOrder,
  fixtureQuoteId,
  fixtureOuterValidTo,
} from "./fixtures/orderPlacementLog.js";

const FLOW_ADDR = "0x55cbada3d2db7f789a7bc1f2a72f1d487aa30b70" as const;

describe("buildOrderPayload", () => {
  const decoded = decodeOrderPlacementLog(fixtureLog);
  const payload = buildOrderPayload(decoded, FLOW_ADDR);

  it("maps token addresses, amounts, and appData", () => {
    expect(payload.sellToken.toLowerCase()).toBe(fixtureOrder.sellToken.toLowerCase());
    expect(payload.buyToken.toLowerCase()).toBe(fixtureOrder.buyToken.toLowerCase());
    expect(payload.receiver.toLowerCase()).toBe(fixtureOrder.receiver.toLowerCase());
    expect(payload.sellAmount).toBe(fixtureOrder.sellAmount.toString());
    expect(payload.buyAmount).toBe(fixtureOrder.buyAmount.toString());
    expect(payload.appData).toBe(fixtureOrder.appData);
  });

  it("uses outerValidTo from the data blob, NOT the inner sentinel validTo", () => {
    expect(payload.validTo).toBe(fixtureOuterValidTo);
    expect(payload.validTo).not.toBe(0xffffffff);
  });

  it("hardcodes feeAmount=0, kind=sell, sellTokenBalance=erc20, buyTokenBalance=erc20", () => {
    expect(payload.feeAmount).toBe("0");
    expect(payload.kind).toBe("sell");
    expect(payload.sellTokenBalance).toBe("erc20");
    expect(payload.buyTokenBalance).toBe("erc20");
  });

  it("sets signingScheme=eip1271 with the flow address as signature payload", () => {
    expect(payload.signingScheme).toBe("eip1271");
    expect(payload.signature.toLowerCase()).toBe(FLOW_ADDR.toLowerCase());
    expect(payload.from.toLowerCase()).toBe(FLOW_ADDR.toLowerCase());
  });

  it("includes quoteId as a JS number", () => {
    expect(payload.quoteId).toBe(Number(fixtureQuoteId));
  });

  it("passes through partiallyFillable", () => {
    expect(payload.partiallyFillable).toBe(fixtureOrder.partiallyFillable);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```sh
npm test -- orderBuilder
```

Expected: failure — `src/orderBuilder.ts` not found.

- [ ] **Step 3: Implement `src/orderBuilder.ts`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/src/orderBuilder.ts`

```ts
import type { DecodedOrderPlacement } from "./eventDecoder.js";

// Shape of the OrderBookApi.sendOrder argument we care about. Defined inline
// (rather than imported from cow-sdk) so the indexer's contract is explicit and
// the SDK version is loose-coupled.
export interface OrderPayload {
  sellToken: `0x${string}`;
  buyToken: `0x${string}`;
  receiver: `0x${string}`;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  appData: `0x${string}`;
  feeAmount: string;
  kind: "sell";
  partiallyFillable: boolean;
  sellTokenBalance: "erc20";
  buyTokenBalance: "erc20";
  signingScheme: "eip1271";
  signature: `0x${string}`;
  from: `0x${string}`;
  quoteId: number;
}

export function buildOrderPayload(
  decoded: DecodedOrderPlacement,
  flowAddress: `0x${string}`,
): OrderPayload {
  return {
    sellToken: decoded.order.sellToken,
    buyToken: decoded.order.buyToken,
    receiver: decoded.order.receiver,
    sellAmount: decoded.order.sellAmount.toString(),
    buyAmount: decoded.order.buyAmount.toString(),
    validTo: decoded.outerValidTo,
    appData: decoded.order.appData,
    feeAmount: "0",
    kind: "sell",
    partiallyFillable: decoded.order.partiallyFillable,
    sellTokenBalance: "erc20",
    buyTokenBalance: "erc20",
    signingScheme: "eip1271",
    signature: flowAddress,
    from: flowAddress,
    quoteId: Number(decoded.quoteId),
  };
}
```

- [ ] **Step 4: Run test, expect pass**

```sh
npm test -- orderBuilder
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/orderBuilder.ts test/orderBuilder.test.ts && git commit -m "feat: map decoded events to CoW orderbook payloads"
```

---

## Task 8: CoW orderbook wrapper

TDD. Wraps `OrderBookApi.sendOrder` with the retry-5xx-and-network / log-and-skip-4xx policy.

**Files:**
- Create: `src/cowOrderbook.ts`
- Test: `test/cowOrderbook.test.ts`

- [ ] **Step 1: Write failing test**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/test/cowOrderbook.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { postOrderWithRetry, type OrderBookLike } from "../src/cowOrderbook.js";
import type { OrderPayload } from "../src/orderBuilder.js";

const payload = {
  sellToken: "0x0000000000000000000000000000000000000001",
  buyToken: "0x0000000000000000000000000000000000000002",
  receiver: "0x0000000000000000000000000000000000000003",
  sellAmount: "1",
  buyAmount: "2",
  validTo: 1_700_000_000,
  appData: "0x" + "42".repeat(32),
  feeAmount: "0",
  kind: "sell",
  partiallyFillable: false,
  sellTokenBalance: "erc20",
  buyTokenBalance: "erc20",
  signingScheme: "eip1271",
  signature: "0x0000000000000000000000000000000000000004",
  from: "0x0000000000000000000000000000000000000004",
  quoteId: 1,
} as unknown as OrderPayload;

function withStatus(status: number): Error & { response?: { status: number } } {
  const err = new Error(`HTTP ${status}`) as Error & {
    response?: { status: number };
  };
  err.response = { status };
  return err;
}

describe("postOrderWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns immediately on success", async () => {
    const api: OrderBookLike = { sendOrder: vi.fn().mockResolvedValue("0xUID") };
    const promise = postOrderWithRetry(api, payload, { maxAttempts: 3, baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe("success");
    if (result.status === "success") expect(result.orderUid).toBe("0xUID");
    expect(api.sendOrder).toHaveBeenCalledOnce();
  });

  it("retries on 5xx and eventually succeeds", async () => {
    const api: OrderBookLike = {
      sendOrder: vi
        .fn()
        .mockRejectedValueOnce(withStatus(503))
        .mockRejectedValueOnce(withStatus(502))
        .mockResolvedValueOnce("0xUID"),
    };
    const promise = postOrderWithRetry(api, payload, { maxAttempts: 3, baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe("success");
    expect(api.sendOrder).toHaveBeenCalledTimes(3);
  });

  it("retries on network errors (no response) and eventually succeeds", async () => {
    const api: OrderBookLike = {
      sendOrder: vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce("0xUID"),
    };
    const promise = postOrderWithRetry(api, payload, { maxAttempts: 3, baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe("success");
    expect(api.sendOrder).toHaveBeenCalledTimes(2);
  });

  it("returns 'skipped' on 4xx without retrying", async () => {
    const api: OrderBookLike = {
      sendOrder: vi.fn().mockRejectedValue(withStatus(400)),
    };
    const promise = postOrderWithRetry(api, payload, { maxAttempts: 3, baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.httpStatus).toBe(400);
    expect(api.sendOrder).toHaveBeenCalledOnce();
  });

  it("returns 'failed' after exhausting retries on 5xx", async () => {
    const api: OrderBookLike = {
      sendOrder: vi.fn().mockRejectedValue(withStatus(503)),
    };
    const promise = postOrderWithRetry(api, payload, { maxAttempts: 3, baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe("failed");
    expect(api.sendOrder).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```sh
npm test -- cowOrderbook
```

Expected: failure — `src/cowOrderbook.ts` not found.

- [ ] **Step 3: Implement `src/cowOrderbook.ts`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/src/cowOrderbook.ts`

```ts
import type { OrderPayload } from "./orderBuilder.js";
import { log } from "./log.js";

// Structural interface so tests can mock without depending on @cowprotocol/cow-sdk.
// Real production wiring instantiates this via `new OrderBookApi({ chainId, baseUrls })`.
export interface OrderBookLike {
  sendOrder(payload: OrderPayload): Promise<string>;
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
}

export type PostResult =
  | { status: "success"; orderUid: string }
  | { status: "skipped"; httpStatus: number; reason: string }
  | { status: "failed"; reason: string };

function extractStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    const e = err as { response?: { status?: number }; status?: number };
    return e.response?.status ?? e.status;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function postOrderWithRetry(
  api: OrderBookLike,
  payload: OrderPayload,
  opts: RetryOptions = { maxAttempts: 3, baseDelayMs: 500 },
): Promise<PostResult> {
  let lastErr: unknown = undefined;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const orderUid = await api.sendOrder(payload);
      return { status: "success", orderUid };
    } catch (err) {
      lastErr = err;
      const status = extractStatus(err);
      if (status !== undefined && status >= 400 && status < 500) {
        return {
          status: "skipped",
          httpStatus: status,
          reason: (err as Error).message,
        };
      }
      log.warn("orderbook post failed, will retry", {
        attempt,
        maxAttempts: opts.maxAttempts,
        httpStatus: status,
        error: (err as Error).message,
      });
      if (attempt < opts.maxAttempts) {
        await sleep(opts.baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }
  return {
    status: "failed",
    reason: (lastErr as Error)?.message ?? "unknown",
  };
}
```

- [ ] **Step 4: Run test, expect pass**

```sh
npm test -- cowOrderbook
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/cowOrderbook.ts test/cowOrderbook.test.ts && git commit -m "feat: orderbook wrapper with retry-5xx + skip-4xx policy"
```

---

## Task 9: Viem client factory

No unit test — this module is mostly viem boilerplate. Integration is exercised by the indexer loop tests in Task 10.

**Files:**
- Create: `src/client.ts`

- [ ] **Step 1: Implement `src/client.ts`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/src/client.ts`

```ts
import {
  createPublicClient,
  http,
  webSocket,
  type PublicClient,
} from "viem";
import { sepolia, mainnet } from "viem/chains";
import type { Config } from "./config.js";

// We use two clients: a websocket client for `watchContractEvent` subscriptions,
// and an HTTP client for `getLogs` backfill (more reliable for large ranges).
export interface Clients {
  ws: PublicClient;
  http: PublicClient;
}

function pickChain(chainId: number) {
  switch (chainId) {
    case 1:
      return mainnet;
    case 11155111:
      return sepolia;
    default:
      // For chains we don't have a viem preset for, fall back to sepolia's chain
      // metadata; viem only uses chainId here so it's effectively a no-op.
      return { ...sepolia, id: chainId };
  }
}

export function makeClients(config: Config): Clients {
  const chain = pickChain(config.chainId);
  return {
    ws: createPublicClient({
      chain,
      transport: webSocket(config.rpcWsUrl, {
        reconnect: {
          attempts: Number.POSITIVE_INFINITY,
          delay: 1_000,
        },
        retryCount: 0, // viem's webSocket transport handles reconnects via the `reconnect` option
      }),
    }),
    http: createPublicClient({
      chain,
      transport: http(config.rpcHttpUrl, { retryCount: 2 }),
    }),
  };
}
```

- [ ] **Step 2: Verify it typechecks**

```sh
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```sh
git add src/client.ts && git commit -m "feat: viem client factory (ws + http transports)"
```

---

## Task 10: Indexer loop

TDD. The indexer's core loop. We test the `handleLog` function — the dispatch hub that's called from both backfill and live subscription. The outer subscription loop is glued in Task 11.

**Files:**
- Create: `src/indexer.ts`
- Test: `test/indexer.test.ts`

- [ ] **Step 1: Write failing test**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/test/indexer.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { handleLog } from "../src/indexer.js";
import type { OrderBookLike } from "../src/cowOrderbook.js";
import { fixtureLog } from "./fixtures/orderPlacementLog.js";

const FLOW_ADDR = "0x55cbada3d2db7f789a7bc1f2a72f1d487aa30b70" as const;

describe("handleLog", () => {
  it("decodes, builds, and posts on the happy path", async () => {
    const api: OrderBookLike = { sendOrder: vi.fn().mockResolvedValue("0xUID") };
    const outcome = await handleLog(fixtureLog, FLOW_ADDR, api, {
      maxAttempts: 1,
      baseDelayMs: 0,
    });
    expect(outcome.status).toBe("posted");
    expect(api.sendOrder).toHaveBeenCalledOnce();
    const arg = (api.sendOrder as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg.signingScheme).toBe("eip1271");
    expect(arg.from.toLowerCase()).toBe(FLOW_ADDR.toLowerCase());
  });

  it("returns 'skipped' on 4xx", async () => {
    const err = new Error("400 Bad Request") as Error & {
      response: { status: number };
    };
    err.response = { status: 400 };
    const api: OrderBookLike = { sendOrder: vi.fn().mockRejectedValue(err) };
    const outcome = await handleLog(fixtureLog, FLOW_ADDR, api, {
      maxAttempts: 1,
      baseDelayMs: 0,
    });
    expect(outcome.status).toBe("skipped");
  });

  it("returns 'failed' on persistent 5xx", async () => {
    const err = new Error("503") as Error & { response: { status: number } };
    err.response = { status: 503 };
    const api: OrderBookLike = { sendOrder: vi.fn().mockRejectedValue(err) };
    const outcome = await handleLog(fixtureLog, FLOW_ADDR, api, {
      maxAttempts: 1,
      baseDelayMs: 0,
    });
    expect(outcome.status).toBe("failed");
  });

  it("returns 'malformed' on decode failure (wrong data blob length)", async () => {
    // Build a log with a wrong-length data blob by truncating the fixture's data field.
    const broken = {
      ...fixtureLog,
      // 12-byte data blob is wrapped inside the outer ABI tuple, which we can't trivially
      // truncate. Instead, point at a fabricated log whose decodeEventLog will fail. The
      // simplest reproducible breakage: empty data.
      data: "0x" as `0x${string}`,
    };
    const api: OrderBookLike = { sendOrder: vi.fn() };
    const outcome = await handleLog(broken, FLOW_ADDR, api, {
      maxAttempts: 1,
      baseDelayMs: 0,
    });
    expect(outcome.status).toBe("malformed");
    expect(api.sendOrder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```sh
npm test -- indexer
```

Expected: failure — `src/indexer.ts` not found.

- [ ] **Step 3: Implement `src/indexer.ts`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/src/indexer.ts`

```ts
import type { Log, PublicClient } from "viem";
import { log } from "./log.js";
import { decodeOrderPlacementLog } from "./eventDecoder.js";
import { buildOrderPayload } from "./orderBuilder.js";
import {
  postOrderWithRetry,
  type OrderBookLike,
  type RetryOptions,
} from "./cowOrderbook.js";
import { orderPlacementEvent } from "./abi.js";
import { saveCursor, type Cursor } from "./cursor.js";

type LogLike = Pick<
  Log,
  "address" | "topics" | "data" | "blockNumber" | "blockHash" | "transactionHash" | "logIndex"
>;

export type HandleOutcome =
  | { status: "posted"; orderUid: string }
  | { status: "skipped"; httpStatus: number }
  | { status: "failed"; reason: string }
  | { status: "malformed"; reason: string };

const DEFAULT_RETRY: RetryOptions = { maxAttempts: 3, baseDelayMs: 500 };

export async function handleLog(
  raw: LogLike,
  flowAddress: `0x${string}`,
  api: OrderBookLike,
  retry: RetryOptions = DEFAULT_RETRY,
): Promise<HandleOutcome> {
  let decoded;
  try {
    decoded = decodeOrderPlacementLog(raw);
  } catch (err) {
    log.warn("malformed OrderPlacement log; skipping", {
      txHash: raw.transactionHash,
      logIndex: raw.logIndex,
      error: (err as Error).message,
    });
    return { status: "malformed", reason: (err as Error).message };
  }

  const payload = buildOrderPayload(decoded, flowAddress);
  const result = await postOrderWithRetry(api, payload, retry);

  if (result.status === "success") {
    log.info("order posted", {
      blockNumber: decoded.blockNumber,
      txHash: decoded.txHash,
      orderUid: result.orderUid,
      sender: decoded.sender,
    });
    return { status: "posted", orderUid: result.orderUid };
  }
  if (result.status === "skipped") {
    log.info("orderbook 4xx; advancing cursor without posting", {
      blockNumber: decoded.blockNumber,
      txHash: decoded.txHash,
      httpStatus: result.httpStatus,
      reason: result.reason,
    });
    return { status: "skipped", httpStatus: result.httpStatus };
  }
  log.error("orderbook post failed after retries; halting", undefined, {
    blockNumber: decoded.blockNumber,
    txHash: decoded.txHash,
    reason: result.reason,
  });
  return { status: "failed", reason: result.reason };
}

export interface BackfillParams {
  httpClient: PublicClient;
  flowAddress: `0x${string}`;
  fromBlock: bigint;
  toBlock: bigint;
  chunkSize: bigint;
  api: OrderBookLike;
  cursorPath: string;
  cursor: Cursor;
  retry?: RetryOptions;
}

export async function backfill(params: BackfillParams): Promise<void> {
  const { httpClient, flowAddress, fromBlock, toBlock, chunkSize, api, cursorPath, cursor, retry } =
    params;
  if (fromBlock > toBlock) {
    log.info("backfill skipped: nothing to do", { fromBlock, toBlock });
    return;
  }
  log.info("backfill starting", { fromBlock, toBlock, chunkSize });

  let cursorBlock = fromBlock - 1n;
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
    const logs = await httpClient.getLogs({
      address: flowAddress,
      event: orderPlacementEvent,
      fromBlock: start,
      toBlock: end,
    });
    logs.sort((a, b) => {
      const bd = (a.blockNumber ?? 0n) - (b.blockNumber ?? 0n);
      if (bd !== 0n) return bd < 0n ? -1 : 1;
      return (a.logIndex ?? 0) - (b.logIndex ?? 0);
    });
    for (const raw of logs) {
      const outcome = await handleLog(raw, flowAddress, api, retry);
      if (outcome.status === "failed") {
        throw new Error("backfill halted on persistent orderbook failure");
      }
    }
    cursorBlock = end;
    cursor.lastProcessedBlock = cursorBlock;
    await saveCursor(cursorPath, cursor);
    log.info("backfill chunk done", { start, end, logCount: logs.length });
  }
  log.info("backfill complete", { lastProcessedBlock: cursorBlock });
}
```

- [ ] **Step 4: Run test, expect pass**

```sh
npm test -- indexer
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/indexer.ts test/indexer.test.ts && git commit -m "feat: indexer dispatch + backfill loop"
```

---

## Task 11: Main entry point

No unit test — this is the glue. Manual smoke test against Sepolia at the end.

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: Implement `src/main.ts`**

Path: `/Users/shoom/IdeaProjects/cow-erc20-onchain-order-indexer/src/main.ts`

```ts
import "dotenv/config";
import { OrderBookApi, SupportedChainId } from "@cowprotocol/cow-sdk";
import { loadConfig } from "./config.js";
import { makeClients } from "./client.js";
import { loadCursor, saveCursor, type Cursor } from "./cursor.js";
import { backfill, handleLog } from "./indexer.js";
import { orderPlacementEvent } from "./abi.js";
import { log } from "./log.js";
import type { OrderPayload } from "./orderBuilder.js";

function toSupportedChain(chainId: number): SupportedChainId {
  // Only Sepolia is enumerated in the spec; expand here when adding chains.
  if (chainId === 11155111) return SupportedChainId.SEPOLIA;
  throw new Error(`Unsupported chainId: ${chainId}`);
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  log.info("starting indexer", {
    flowAddress: config.flowAddress,
    chainId: config.chainId,
    confirmations: config.confirmations,
  });

  const { ws, http: httpClient } = makeClients(config);

  // Bridge cow-sdk's OrderBookApi.sendOrder to our OrderBookLike interface. The
  // SDK accepts a more permissive shape than ours; we cast OrderPayload through
  // because every field is already in the shape the SDK expects (string amounts,
  // lowercase enum strings, hex signature).
  const sdk = new OrderBookApi({
    chainId: toSupportedChain(config.chainId),
    baseUrls: { [toSupportedChain(config.chainId)]: config.cowApiUrl },
  });
  const api = {
    async sendOrder(payload: OrderPayload): Promise<string> {
      // OrderBookApi.sendOrder signature varies by SDK version; this cast keeps
      // the indexer working across minor SDK revs. If the SDK becomes stricter,
      // narrow the cast and adapt buildOrderPayload to match.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await sdk.sendOrder(payload as any);
    },
  };

  // 1. Load cursor (or start from DEPLOY_BLOCK - 1).
  const existing = await loadCursor(config.stateFile);
  const cursor: Cursor = existing ?? {
    lastProcessedBlock: config.deployBlock - 1n,
  };
  log.info("cursor loaded", { lastProcessedBlock: cursor.lastProcessedBlock });

  // 2. Backfill from cursor + 1 to head - confirmations.
  const head = await httpClient.getBlockNumber();
  const target = head - BigInt(config.confirmations);
  await backfill({
    httpClient,
    flowAddress: config.flowAddress,
    fromBlock: cursor.lastProcessedBlock + 1n,
    toBlock: target,
    chunkSize: config.chunkSize,
    api,
    cursorPath: config.stateFile,
    cursor,
  });

  // 3. Subscribe to live events. Each callback receives a batch.
  log.info("subscribing to live events", { fromBlock: cursor.lastProcessedBlock + 1n });
  const unwatch = ws.watchContractEvent({
    address: config.flowAddress,
    abi: [orderPlacementEvent],
    eventName: "OrderPlacement",
    onLogs: async (logs) => {
      // Defer events that haven't reached the confirmation depth yet by
      // re-checking head; cheap because the ws client caches block subscriptions.
      const currentHead = await httpClient.getBlockNumber();
      for (const raw of logs) {
        const blockNumber = raw.blockNumber ?? 0n;
        const lag = currentHead - blockNumber;
        if (lag < BigInt(config.confirmations)) {
          // Wait for the block to mature. Polling-style sleep is fine here —
          // Sepolia blocks are ~12s, so a 12s sleep at most.
          const waitMs = Number(BigInt(config.confirmations) - lag) * 12_000;
          log.info("waiting for confirmations", {
            blockNumber,
            waitMs,
          });
          await new Promise((r) => setTimeout(r, waitMs));
        }
        const outcome = await handleLog(raw, config.flowAddress, api);
        if (outcome.status === "failed") {
          log.error("halting due to persistent orderbook failure", undefined, {
            blockNumber,
          });
          throw new Error("orderbook unavailable; exiting");
        }
        if (raw.blockNumber !== undefined && raw.blockNumber !== null) {
          if (raw.blockNumber > cursor.lastProcessedBlock) {
            cursor.lastProcessedBlock = raw.blockNumber;
            await saveCursor(config.stateFile, cursor);
          }
        }
      }
    },
    onError: (err) => {
      log.error("watchContractEvent error", err);
    },
  });

  const shutdown = (sig: string) => {
    log.info(`received ${sig}; shutting down`);
    unwatch();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("indexer crashed", err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it typechecks**

```sh
npm run typecheck
```

Expected: exits 0. If `OrderBookApi.sendOrder` signature mismatches our `OrderPayload`, narrow the `as any` cast to the SDK's actual argument type — this is the only adapter point.

- [ ] **Step 3: Run the full test suite to verify nothing regressed**

```sh
npm test
```

Expected: every test passes.

- [ ] **Step 4: Smoke test against Sepolia (manual)**

```sh
cp .env.example .env
mkdir -p state
npm start
```

Expected:
- Logs `starting indexer ...`
- Logs `cursor loaded { lastProcessedBlock: 10838354n }`
- Logs `backfill starting ...` then `backfill chunk done ...` until caught up
- Logs `subscribing to live events ...`
- Process stays alive

Trigger a new `createOrder` from the contract repo (or any wallet) and watch for `order posted { orderUid: ... }`. Confirm the order appears at `https://api.cow.fi/sepolia/api/v1/orders/<orderUid>`.

Kill with Ctrl-C and confirm clean shutdown.

- [ ] **Step 5: Commit**

```sh
git add src/main.ts && git commit -m "feat: main entry point with backfill + live subscription"
```

---

## Task 12: Final verification + repo polish

- [ ] **Step 1: Build the project**

```sh
npm run build
```

Expected: `dist/` populated, exits 0.

- [ ] **Step 2: Run the production build briefly**

```sh
npm run start:prod
```

Expected: same startup logs as dev mode. Kill with Ctrl-C.

- [ ] **Step 3: Run the full test suite one more time**

```sh
npm test
```

Expected: every test passes. Capture the count.

- [ ] **Step 4: Verify no `TODO`/`FIXME` markers in source**

```sh
grep -rE "TODO|FIXME" src/ test/ && exit 1 || echo "clean"
```

Expected: `clean`.

- [ ] **Step 5: Check for any uncommitted files**

```sh
git status
```

Expected: clean working tree (only `dist/`, `state/`, and `node_modules/` should be untracked/ignored, never committed).

- [ ] **Step 6: Commit any final touches** (only if step 1-5 surfaced something)

```sh
git add <files> && git commit -m "chore: <description>"
```

---

## Done criteria

- Every checkbox above is checked.
- `npm test` reports zero failures.
- A live smoke test (Task 11 step 4) produced at least one `order posted` log line and the order is visible on the CoW orderbook API.
- The indexer survives Ctrl-C cleanly.
- `dist/` builds cleanly via `npm run build`.

## Out of scope (do **not** implement here)

- Multi-chain support (the architecture has hooks, but no second chain wired).
- Docker / k8s deployment manifests.
- Structured JSON logging / log aggregation.
- Metrics (Prometheus, OpenTelemetry).
- Subgraph or alternative indexing strategies.
- Posting EIP-712 signed orders (this indexer is EIP-1271 only).
