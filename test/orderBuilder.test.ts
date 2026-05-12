import { describe, it, expect } from "vitest";
import { buildOrderPayload } from "../src/orderBuilder.js";
import { decodeOrderPlacementLog } from "../src/eventDecoder.js";
import {
  fixtureLog,
  fixtureOrder,
  fixtureQuoteId,
  fixtureValidTo,
} from "./fixtures/orderPlacementLog.js";

const FLOW_ADDR = "0x55cbada3d2db7f789a7bc1f2a72f1d487aa30b70" as const;

describe("buildOrderPayload", () => {
  const decoded = decodeOrderPlacementLog(fixtureLog);
  const payload = buildOrderPayload(decoded, FLOW_ADDR);

  it("maps token addresses, amounts, and appData", () => {
    expect(payload.sellToken.toLowerCase()).toBe(fixtureOrder.sellToken.toLowerCase());
    expect(payload.buyToken.toLowerCase()).toBe(fixtureOrder.buyToken.toLowerCase());
    expect(payload.receiver.toLowerCase()).toBe(fixtureOrder.receiver.toLowerCase());
    expect(payload.sellAmount).toBe(fixtureOrder.sellAmount.toString());
    expect(payload.buyAmount).toBe(fixtureOrder.buyAmount.toString());
    expect(payload.appData).toBe(fixtureOrder.appData);
  });

  it("uses order.validTo from the event (the real expiry, settlement-enforced)", () => {
    expect(payload.validTo).toBe(fixtureValidTo);
    expect(payload.validTo).not.toBe(0xffffffff);
  });

  it("hardcodes feeAmount=0, kind=sell, sellTokenBalance=erc20, buyTokenBalance=erc20", () => {
    expect(payload.feeAmount).toBe("0");
    expect(payload.kind).toBe("sell");
    expect(payload.sellTokenBalance).toBe("erc20");
    expect(payload.buyTokenBalance).toBe("erc20");
  });

  it("sets signingScheme=eip1271 with the flow address as signature payload", () => {
    expect(payload.signingScheme).toBe("eip1271");
    expect(payload.signature.toLowerCase()).toBe(FLOW_ADDR.toLowerCase());
    expect(payload.from.toLowerCase()).toBe(FLOW_ADDR.toLowerCase());
  });

  it("includes quoteId as a JS number", () => {
    expect(payload.quoteId).toBe(Number(fixtureQuoteId));
  });

  it("passes through partiallyFillable", () => {
    expect(payload.partiallyFillable).toBe(fixtureOrder.partiallyFillable);
  });
});
