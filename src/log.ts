// Minimal console-based logger. Writes line-buffered output to stdout/stderr
// with `[timestamp] [LEVEL] message [extras-as-JSON]`.

type Extras = Record<string, unknown> | undefined;

function format(level: string, msg: string, extras: Extras): string {
  const ts = new Date().toISOString();
  let line = `${ts} [${level}] ${msg}`;
  if (extras !== undefined) {
    line += " " + JSON.stringify(extras, bigintReplacer);
  }
  return line + "\n";
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export const log = {
  info(msg: string, extras?: Extras): void {
    process.stdout.write(format("INFO", msg, extras));
  },
  warn(msg: string, extras?: Extras): void {
    process.stderr.write(format("WARN", msg, extras));
  },
  error(msg: string, err?: unknown, extras?: Extras): void {
    const merged: Record<string, unknown> = { ...(extras ?? {}) };
    if (err instanceof Error) {
      merged.error = err.message;
      if (err.stack) merged.stack = err.stack;
    } else if (err !== undefined) {
      merged.error = String(err);
    }
    process.stderr.write(format("ERROR", msg, merged));
  },
};
