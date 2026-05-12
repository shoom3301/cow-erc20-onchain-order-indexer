import type { DecodedOrderPlacement } from "./eventDecoder.js";

// Shape of the OrderBookApi.sendOrder argument we care about. Defined inline
// (rather than imported from cow-sdk) so the indexer's contract is explicit and
// the SDK version is loose-coupled.
export interface OrderPayload {
  sellToken: `0x${string}`;
  buyToken: `0x${string}`;
  receiver: `0x${string}`;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  appData: `0x${string}`;
  feeAmount: string;
  kind: "sell";
  partiallyFillable: boolean;
  sellTokenBalance: "erc20";
  buyTokenBalance: "erc20";
  signingScheme: "eip1271";
  signature: `0x${string}`;
  from: `0x${string}`;
  quoteId: number;
}

export function buildOrderPayload(
  decoded: DecodedOrderPlacement,
  flowAddress: `0x${string}`,
): OrderPayload {
  return {
    sellToken: decoded.order.sellToken,
    buyToken: decoded.order.buyToken,
    receiver: decoded.order.receiver,
    sellAmount: decoded.order.sellAmount.toString(),
    buyAmount: decoded.order.buyAmount.toString(),
    validTo: decoded.order.validTo,
    appData: decoded.order.appData,
    feeAmount: "0",
    kind: "sell",
    partiallyFillable: decoded.order.partiallyFillable,
    sellTokenBalance: "erc20",
    buyTokenBalance: "erc20",
    signingScheme: "eip1271",
    signature: flowAddress,
    from: flowAddress,
    quoteId: Number(decoded.quoteId),
  };
}
