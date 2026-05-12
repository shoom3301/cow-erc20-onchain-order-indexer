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

  const typedArgs = args as {
    sender: `0x${string}`;
    order: DecodedOrder;
    signature: { scheme: number; data: `0x${string}` };
    data: `0x${string}`;
  };

  const { quoteId, outerValidTo } = parseDataBlob(typedArgs.data);

  return {
    blockNumber: raw.blockNumber ?? 0n,
    blockHash: raw.blockHash ?? null,
    txHash: raw.transactionHash ?? null,
    logIndex: raw.logIndex ?? null,
    sender: typedArgs.sender,
    order: typedArgs.order,
    signature: {
      scheme: Number(typedArgs.signature.scheme),
      data: typedArgs.signature.data,
    },
    quoteId,
    outerValidTo,
  };
}
