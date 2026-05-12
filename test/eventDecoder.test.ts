import { describe, it, expect } from "vitest";
import { decodeOrderPlacementLog } from "../src/eventDecoder.js";
import {
  fixtureLog,
  fixtureSender,
  fixtureOrder,
  fixtureSignature,
  fixtureQuoteId,
  fixtureOuterValidTo,
} from "./fixtures/orderPlacementLog.js";

describe("decodeOrderPlacementLog", () => {
  it("decodes a well-formed OrderPlacement log", () => {
    const decoded = decodeOrderPlacementLog(fixtureLog);
    expect(decoded.sender.toLowerCase()).toBe(fixtureSender.toLowerCase());
    expect(decoded.order.sellAmount).toBe(fixtureOrder.sellAmount);
    expect(decoded.order.buyAmount).toBe(fixtureOrder.buyAmount);
    expect(decoded.order.sellToken.toLowerCase()).toBe(
      fixtureOrder.sellToken.toLowerCase(),
    );
    expect(decoded.order.buyToken.toLowerCase()).toBe(
      fixtureOrder.buyToken.toLowerCase(),
    );
    expect(decoded.order.receiver.toLowerCase()).toBe(
      fixtureOrder.receiver.toLowerCase(),
    );
    expect(decoded.order.validTo).toBe(fixtureOrder.validTo);
    expect(decoded.order.appData).toBe(fixtureOrder.appData);
    expect(decoded.order.feeAmount).toBe(fixtureOrder.feeAmount);
    expect(decoded.order.kind).toBe(fixtureOrder.kind);
    expect(decoded.order.partiallyFillable).toBe(fixtureOrder.partiallyFillable);
    expect(decoded.signature.scheme).toBe(fixtureSignature.scheme);
    expect(decoded.signature.data.toLowerCase()).toBe(
      fixtureSignature.data.toLowerCase(),
    );
    expect(decoded.quoteId).toBe(fixtureQuoteId);
    expect(decoded.outerValidTo).toBe(fixtureOuterValidTo);
    expect(decoded.blockNumber).toBe(fixtureLog.blockNumber);
    expect(decoded.txHash).toBe(fixtureLog.transactionHash);
    expect(decoded.logIndex).toBe(fixtureLog.logIndex);
  });
});

import { parseDataBlob } from "../src/eventDecoder.js";

describe("parseDataBlob", () => {
  it("parses {quoteId, outerValidTo} from 12 packed bytes", () => {
    // int64(123) || uint32(1747083600)
    const blob =
      "0x000000000000007b6822c190" as `0x${string}`;
    const { quoteId, outerValidTo } = parseDataBlob(blob);
    expect(quoteId).toBe(123n);
    expect(outerValidTo).toBe(0x6822c190);
  });

  it("handles negative quoteId (two's complement int64)", () => {
    // int64(-1) || uint32(0)
    const blob = "0xffffffffffffffff00000000" as `0x${string}`;
    const { quoteId, outerValidTo } = parseDataBlob(blob);
    expect(quoteId).toBe(-1n);
    expect(outerValidTo).toBe(0);
  });

  it("throws on wrong length", () => {
    expect(() => parseDataBlob("0x1234" as `0x${string}`)).toThrow(/length/);
    expect(() =>
      parseDataBlob(("0x" + "ab".repeat(20)) as `0x${string}`),
    ).toThrow(/length/);
  });
});
