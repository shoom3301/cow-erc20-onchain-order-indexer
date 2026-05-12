import "dotenv/config";
import { OrderBookApi, SupportedChainId, ORDER_BOOK_PROD_CONFIG } from "@cowprotocol/cow-sdk";
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
  const supportedChain = toSupportedChain(config.chainId);
  const sdk = new OrderBookApi({
    chainId: supportedChain,
    baseUrls: { ...ORDER_BOOK_PROD_CONFIG, [supportedChain]: config.cowApiUrl },
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
  let processing: Promise<void> = Promise.resolve();
  const unwatch = ws.watchContractEvent({
    address: config.flowAddress,
    abi: [orderPlacementEvent],
    eventName: "OrderPlacement",
    onLogs: (logs) => {
      processing = processing.then(async () => {
        const currentHead = await httpClient.getBlockNumber();
        for (const raw of logs) {
          const blockNumber = raw.blockNumber ?? 0n;
          const lag = currentHead - blockNumber;
          if (lag < BigInt(config.confirmations)) {
            const waitMs = Number(BigInt(config.confirmations) - lag) * 12_000;
            log.info("waiting for confirmations", { blockNumber, waitMs });
            await new Promise((r) => setTimeout(r, waitMs));
          }
          const outcome = await handleLog(raw, config.flowAddress, api);
          if (outcome.status === "failed") {
            log.error("halting due to persistent orderbook failure", undefined, {
              blockNumber,
            });
            process.exit(1);
          }
          if (raw.blockNumber !== undefined && raw.blockNumber !== null) {
            if (raw.blockNumber > cursor.lastProcessedBlock) {
              cursor.lastProcessedBlock = raw.blockNumber;
              await saveCursor(config.stateFile, cursor);
            }
          }
        }
      }).catch((err) => {
        log.error("indexer crashed in live subscription", err);
        process.exit(1);
      });
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
