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
    expect(cfg.flowAddress).toBe("0x9288e2a30d5a14622eb70c3af2ad1f1cfbbadfbe");
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
