import * as Sentry from "@sentry/react-native";

const isDev = __DEV__;

export const logger = {
  ble: (message: string, data?: unknown) => {
    if (isDev) {
      console.log(`[BLE] ${message}`, data !== undefined ? data : "");
    }
    if (!isDev) {
      Sentry.addBreadcrumb({ category: "ble", message, data: data as Record<string, unknown>, level: "info" });
    }
  },
  wave: (message: string, data?: unknown) => {
    if (isDev) {
      console.log(`[WAVE] ${message}`, data !== undefined ? data : "");
    }
    if (!isDev) {
      Sentry.addBreadcrumb({ category: "wave", message, data: data as Record<string, unknown>, level: "info" });
    }
  },
  auth: (message: string, data?: unknown) => {
    if (isDev) {
      console.log(`[AUTH] ${message}`, data !== undefined ? data : "");
    }
    if (!isDev) {
      Sentry.addBreadcrumb({ category: "auth", message, data: data as Record<string, unknown>, level: "info" });
    }
  },
  /** Non-fatal warnings — logged to console + Sentry breadcrumbs but NOT as Sentry events.
   *  Use for: expected failures, non-actionable errors, user input validation, non-fatal syncs. */
  warn: (message: string, data?: unknown) => {
    console.warn(`[WARN] ${message}`, data !== undefined ? data : "");
    if (!isDev) {
      Sentry.addBreadcrumb({ category: "warn", message, data: data as Record<string, unknown>, level: "warning" });
    }
  },
  /** Real errors — logged to console AND sent to Sentry as events.
   *  Use for: crashes, unexpected failures, broken flows that need investigation. */
  error: (message: string, error?: unknown) => {
    console.error(`[ERROR] ${message}`, error !== undefined ? error : "");
    if (!isDev) {
      if (error instanceof Error) {
        Sentry.captureException(error, { extra: { message } });
      } else {
        Sentry.captureMessage(message, { level: "error", extra: { error } });
      }
    }
  },
};
