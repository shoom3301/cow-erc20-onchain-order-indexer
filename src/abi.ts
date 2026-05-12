// OrderPlacement event ABI for CoWSwapErc20Flow, vendored from
// `src/interfaces/ICoWSwapOnchainOrders.sol` in the contract repo.
//
// Event topic hash: 0xcf5f9de2984132265203b5c335b25727702ca77262ff622e136baa7362bf1da9
//
// `const` assertion lets viem infer the parsed log shape.

export const orderPlacementEvent = {
  type: "event",
  name: "OrderPlacement",
  inputs: [
    { name: "sender", type: "address", indexed: true },
    {
      name: "order",
      type: "tuple",
      indexed: false,
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
      indexed: false,
      components: [
        { name: "scheme", type: "uint8" },
        { name: "data", type: "bytes" },
      ],
    },
    { name: "data", type: "bytes", indexed: false },
  ],
} as const;

export const flowAbi = [orderPlacementEvent] as const;

// keccak256("sell") -> the value of GPv2Order.KIND_SELL.
// Used as a defensive assertion in eventDecoder.
export const KIND_SELL =
  "0xf3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775" as const;

// keccak256("erc20")
export const BALANCE_ERC20 =
  "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9" as const;
