import { describe, it, expect, vi } from "vitest";
import { handleLog } from "../src/indexer.js";
import type { OrderBookLike } from "../src/cowOrderbook.js";
import { fixtureLog } from "./fixtures/orderPlacementLog.js";

const FLOW_ADDR = "0x9288e2a30d5a14622eb70c3af2ad1f1cfbbadfbe" as const;

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
