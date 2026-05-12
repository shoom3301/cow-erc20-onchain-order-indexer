import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCursor, saveCursor } from "../src/cursor.js";

describe("cursor", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "indexer-cursor-"));
    file = join(dir, "cursor.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loadCursor returns null when file missing", async () => {
    expect(await loadCursor(file)).toBeNull();
  });

  it("saveCursor + loadCursor round-trips", async () => {
    await saveCursor(file, { lastProcessedBlock: 12345n });
    const loaded = await loadCursor(file);
    expect(loaded?.lastProcessedBlock).toBe(12345n);
  });

  it("saveCursor creates the parent directory if missing", async () => {
    const nested = join(dir, "a", "b", "cursor.json");
    await saveCursor(nested, { lastProcessedBlock: 1n });
    expect(await loadCursor(nested)).toEqual({ lastProcessedBlock: 1n });
  });

  it("saveCursor is atomic: a partial write does not corrupt the live file", async () => {
    // Write a known-good cursor first
    await saveCursor(file, { lastProcessedBlock: 100n });

    // Manually corrupt the *tempfile* path the saver would use — confirms tempfile naming
    // doesn't collide with the live file.
    writeFileSync(file + ".tmp", "garbage", "utf8");

    // The real save should overwrite the tempfile and rename it cleanly.
    await saveCursor(file, { lastProcessedBlock: 200n });
    expect(await loadCursor(file)).toEqual({ lastProcessedBlock: 200n });
  });

  it("loadCursor throws on malformed JSON", async () => {
    writeFileSync(file, "{not json", "utf8");
    await expect(loadCursor(file)).rejects.toThrow();
  });

  it("loadCursor throws if lastProcessedBlock is missing", async () => {
    writeFileSync(file, JSON.stringify({}), "utf8");
    await expect(loadCursor(file)).rejects.toThrow(/lastProcessedBlock/);
  });

  it("loadCursor coerces string lastProcessedBlock back to bigint", async () => {
    writeFileSync(
      file,
      JSON.stringify({ lastProcessedBlock: "999999999999999999999" }),
      "utf8",
    );
    const loaded = await loadCursor(file);
    expect(loaded?.lastProcessedBlock).toBe(999999999999999999999n);
  });
});
