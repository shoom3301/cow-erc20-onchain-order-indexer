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
