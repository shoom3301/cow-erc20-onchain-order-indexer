import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface Cursor {
  lastProcessedBlock: bigint;
}

export async function loadCursor(path: string): Promise<Cursor | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const parsed = JSON.parse(raw) as { lastProcessedBlock?: string | number };
  if (parsed.lastProcessedBlock === undefined) {
    throw new Error("Cursor file missing lastProcessedBlock");
  }
  return { lastProcessedBlock: BigInt(parsed.lastProcessedBlock) };
}

export async function saveCursor(path: string, cursor: Cursor): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  const body = JSON.stringify(
    { lastProcessedBlock: cursor.lastProcessedBlock.toString() },
    null,
    2,
  );
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
}
