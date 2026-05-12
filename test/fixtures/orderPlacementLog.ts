// A hand-crafted OrderPlacement log used by eventDecoder tests.
//
// The data is ABI-encoded according to the event ABI in src/abi.ts. The trailing
// `bytes data` field within the event holds `abi.encodePacked(int64 quoteId, uint32 outerValidTo)`
// (12 bytes) as emitted by CoWSwapErc20Flow.createOrder.
//
// To regenerate from a real onchain event, use:
//   cast logs --rpc-url $RPC_HTTP_URL \
//     --from-block 10838355 \
//     --address 0x55cbada3d2db7f789a7bc1f2a72f1d487aa30b70 \
//     "OrderPlacement(address,((address,address,address,uint256,uint256,uint32,bytes32,uint256,bytes32,bool,bytes32,bytes32),(uint8,bytes),bytes))"
// and paste the topics + data below.

import { encodeAbiParameters, encodePacked, pad } from "viem";

const SENDER = "0xfb3c7eb936caa12b5a884d612393969a557d4307" as const;
const SELL  = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" as const; // Sepolia WETH
const BUY   = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const; // Sepolia USDC (random pick)
const RECEIVER = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa" as const;
const FLOW_ADDR = "0x55cbada3d2db7f789a7bc1f2a72f1d487aa30b70" as const;

const KIND_SELL =
  "0xf3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775" as const;
const BALANCE_ERC20 =
  "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9" as const;

export const fixtureSender = SENDER;
export const fixtureSellToken = SELL;
export const fixtureBuyToken  = BUY;
export const fixtureReceiver  = RECEIVER;
export const fixtureQuoteId   = 123n;
export const fixtureOuterValidTo = 1747083600; // 2026-05-12T13:00:00Z-ish

export const fixtureOrder = {
  sellToken: SELL,
  buyToken:  BUY,
  receiver:  RECEIVER,
  sellAmount: 10n ** 16n,           // 0.01 sellToken (1e16)
  buyAmount:  10_000_000n,          // 10 USDC (6 decimals)
  validTo:    0xffffffff,
  appData:    "0x4242424242424242424242424242424242424242424242424242424242424242" as `0x${string}`,
  feeAmount:  0n,
  kind:       KIND_SELL,
  partiallyFillable: false,
  sellTokenBalance:  BALANCE_ERC20,
  buyTokenBalance:   BALANCE_ERC20,
} as const;

export const fixtureSignature = {
  scheme: 0,
  data: FLOW_ADDR.toLowerCase() as `0x${string}`,
};

const dataBlob = encodePacked(
  ["int64", "uint32"],
  [fixtureQuoteId, fixtureOuterValidTo],
);

const eventData = encodeAbiParameters(
  [
    {
      name: "order",
      type: "tuple",
      components: [
        { name: "sellToken", type: "address" },
        { name: "buyToken", type: "address" },
        { name: "receiver", type: "address" },
        { name: "sellAmount", type: "uint256" },
        { name: "buyAmount", type: "uint256" },
        { name: "validTo", type: "uint32" },
        { name: "appData", type: "bytes32" },
        { name: "feeAmount", type: "uint256" },
        { name: "kind", type: "bytes32" },
        { name: "partiallyFillable", type: "bool" },
        { name: "sellTokenBalance", type: "bytes32" },
        { name: "buyTokenBalance", type: "bytes32" },
      ],
    },
    {
      name: "signature",
      type: "tuple",
      components: [
        { name: "scheme", type: "uint8" },
        { name: "data", type: "bytes" },
      ],
    },
    { name: "data", type: "bytes" },
  ],
  [fixtureOrder, fixtureSignature, dataBlob],
);

export const fixtureLog = {
  address: FLOW_ADDR,
  topics: [
    // keccak256("OrderPlacement(address,(address,address,address,uint256,uint256,uint32,bytes32,uint256,bytes32,bool,bytes32,bytes32),(uint8,bytes),bytes)")
    "0xcf5f9de2984132265203b5c335b25727702ca77262ff622e136baa7362bf1da9",
    pad(SENDER, { size: 32 }),
  ] as [`0x${string}`, `0x${string}`],
  data: eventData,
  blockNumber: 10_900_000n,
  blockHash: "0x" + "ab".repeat(32) as `0x${string}`,
  transactionHash: "0x" + "cd".repeat(32) as `0x${string}`,
  logIndex: 7,
  transactionIndex: 0,
  removed: false,
} as const;
