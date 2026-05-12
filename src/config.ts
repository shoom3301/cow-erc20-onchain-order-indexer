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
