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
      event: orderPlacementEvent as Parameters<typeof httpClient.getLogs>[0]["event"],
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
