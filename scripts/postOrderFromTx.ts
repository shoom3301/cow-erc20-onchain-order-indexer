// Manual recovery script. Given a transaction hash containing an OrderPlacement
// event from the configured flow contract, decode the event and POST the order
// to the CoW orderbook. Use this to retry orders the indexer missed or when
// debugging payload issues.
//
// Usage:
//   npx tsx scripts/postOrderFromTx.ts <txHash>
//   npm run post-order -- <txHash>

import "dotenv/config";
import { createPublicClient, http } from "viem";
import { sepolia, mainnet } from "viem/chains";
import {
  OrderBookApi,
  SupportedChainId,
  ORDER_BOOK_PROD_CONFIG,
} from "@cowprotocol/cow-sdk";
import { loadConfig } from "../src/config.js";
import { orderPlacementEvent } from "../src/abi.js";
import { decodeOrderPlacementLog } from "../src/eventDecoder.js";
import { buildOrderPayload, type OrderPayload } from "../src/orderBuilder.js";
import { log } from "../src/log.js";

const ORDER_PLACEMENT_TOPIC =
  "0xcf5f9de2984132265203b5c335b25727702ca77262ff622e136baa7362bf1da9";

function usage(): never {
  console.error("Usage: tsx scripts/postOrderFromTx.ts <txHash>");
  process.exit(64);
}

function toSupportedChain(chainId: number): SupportedChainId {
  if (chainId === 11155111) return SupportedChainId.SEPOLIA;
  if (chainId === 1) return SupportedChainId.MAINNET;
  throw new Error(`Unsupported chainId: ${chainId}`);
}

async function main(): Promise<void> {
  const txHash = process.argv[2];
  if (!txHash) usage();
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    console.error(`Invalid tx hash: ${txHash}`);
    process.exit(64);
  }

  const config = loadConfig(process.env);
  log.info("posting order from tx", {
    txHash,
    flowAddress: config.flowAddress,
    cowApiUrl: config.cowApiUrl,
  });

  const chain = config.chainId === 1 ? mainnet : sepolia;
  const client = createPublicClient({
    chain,
    transport: http(config.rpcHttpUrl),
  });

  const receipt = await client.getTransactionReceipt({
    hash: txHash as `0x${string}`,
  });

  const orderLogs = receipt.logs.filter(
    (l) =>
      l.address.toLowerCase() === config.flowAddress.toLowerCase() &&
      l.topics[0]?.toLowerCase() === ORDER_PLACEMENT_TOPIC,
  );

  if (orderLogs.length === 0) {
    log.error("no OrderPlacement event found in this tx", undefined, {
      flowAddress: config.flowAddress,
      logCount: receipt.logs.length,
    });
    process.exit(2);
  }

  const supportedChain = toSupportedChain(config.chainId);
  const sdk = new OrderBookApi({
    chainId: supportedChain,
    baseUrls: { ...ORDER_BOOK_PROD_CONFIG, [supportedChain]: config.cowApiUrl },
  });

  let failureCount = 0;
  for (const raw of orderLogs) {
    const decoded = decodeOrderPlacementLog(raw);
    const payload = buildOrderPayload(decoded, config.flowAddress);
    log.info("decoded OrderPlacement", {
      blockNumber: decoded.blockNumber,
      logIndex: decoded.logIndex,
      sender: decoded.sender,
      sellToken: decoded.order.sellToken,
      buyToken: decoded.order.buyToken,
      sellAmount: decoded.order.sellAmount,
      buyAmount: decoded.order.buyAmount,
      validTo: decoded.outerValidTo,
      quoteId: decoded.quoteId,
    });
    console.log("\nPayload:\n", JSON.stringify(payload, null, 2));

    try {
      // The SDK's sendOrder type varies by version; payload shape is correct.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orderUid = await sdk.sendOrder(payload as any);
      log.info("order posted", { orderUid });
      console.log(
        `\nFetch with: curl ${config.cowApiUrl}/api/v1/orders/${orderUid}`,
      );
    } catch (err) {
      failureCount += 1;
      const e = err as Error & {
        response?: { status?: number };
        body?: unknown;
      };
      log.error("sendOrder failed", e, {
        httpStatus: e.response?.status,
        body: e.body,
      });
    }
  }

  if (failureCount > 0) process.exit(1);
}

main().catch((err) => {
  log.error("script crashed", err);
  process.exit(1);
});
