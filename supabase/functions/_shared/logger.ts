/**
 * Shared structured logger for Edge Functions.
 *
 * Outputs JSON lines to stdout/stderr for Supabase log ingestion.
 * Each log entry includes: timestamp, request ID, function name,
 * user ID (when available), log level, message, and arbitrary extras.
 *
 * Usage:
 *   const log = createLogger("send-wave");
 *   log.setUserId(user.id);
 *   log.info("Wave sent", { target: token, status: "pending" });
 *   log.result(200, { matched: true });
 */

export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  setUserId(uid: string): void;
  /** Log the final result with duration. Call before returning the Response. */
  result(status: number, extra?: Record<string, unknown>): void;
}

export function createLogger(fn: string): Logger {
  const rid = crypto.randomUUID().substring(0, 8);
  const start = Date.now();
  let uid: string | null = null;

  function emit(level: string, msg: string, extra?: Record<string, unknown>) {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      rid,
      fn,
      level,
      msg,
    };
    if (uid) entry.uid = uid;
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        entry[k] = v;
      }
    }

    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  return {
    info: (msg, extra) => emit("info", msg, extra),
    warn: (msg, extra) => emit("warn", msg, extra),
    error: (msg, extra) => emit("error", msg, extra),
    setUserId: (id) => { uid = id; },
    result: (status, extra) => {
      emit("info", "done", {
        status,
        duration_ms: Date.now() - start,
        ...extra,
      });
    },
  };
}
