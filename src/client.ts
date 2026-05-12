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
