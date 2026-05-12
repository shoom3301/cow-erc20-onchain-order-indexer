import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "../src/log.js";

describe("log", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("emits info to stdout with [INFO] prefix", () => {
    log.info("hello world");
    expect(stdoutSpy).toHaveBeenCalledOnce();
    const line = stdoutSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[INFO]");
    expect(line).toContain("hello world");
    expect(line.endsWith("\n")).toBe(true);
  });

  it("emits warn to stderr with [WARN] prefix", () => {
    log.warn("careful");
    expect(stderrSpy).toHaveBeenCalledOnce();
    const line = stderrSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[WARN]");
    expect(line).toContain("careful");
  });

  it("emits error to stderr with [ERROR] prefix and includes Error stack", () => {
    const err = new Error("boom");
    log.error("failure", err);
    expect(stderrSpy).toHaveBeenCalledOnce();
    const line = stderrSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[ERROR]");
    expect(line).toContain("failure");
    expect(line).toContain("boom");
  });

  it("serializes extra data as JSON", () => {
    log.info("event", { block: 1n, foo: "bar" });
    const line = stdoutSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain('"block":"1"');
    expect(line).toContain('"foo":"bar"');
  });

  it("includes an ISO timestamp prefix", () => {
    log.info("ts");
    const line = stdoutSpy.mock.calls[0]?.[0] as string;
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
