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
