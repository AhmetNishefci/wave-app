import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/utils/logger";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[Supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. " +
      "Supabase features will not work. Set them in .env file.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * Invoke a Supabase edge function with a timeout guard (TD-1 fix).
 * Prevents the UI from hanging indefinitely when the edge function proxy
 * queues requests (free tier: 2 concurrent) or the network is degraded.
 *
 * Returns `{ data: null, error: { message: "timeout" } }` on timeout,
 * matching the shape callers already expect from `supabase.functions.invoke`.
 */
const DEFAULT_INVOKE_TIMEOUT_MS = 10_000;

export async function invokeWithTimeout<T = unknown>(
  functionName: string,
  options?: { body?: Record<string, unknown>; timeoutMs?: number },
): Promise<{ data: T | null; error: { message: string } | null }> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;

  const invokePromise = supabase.functions.invoke(functionName, {
    body: options?.body,
  });

  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });

  try {
    const result = await Promise.race([invokePromise, timeoutPromise]);
    clearTimeout(timer!);
    return result as { data: T | null; error: { message: string } | null };
  } catch (err: unknown) {
    clearTimeout(timer!);
    const message = err instanceof Error ? err.message : "timeout";
    logger.warn(`Edge function ${functionName} failed: ${message}`, {
      functionName,
      timeoutMs,
    });
    return { data: null, error: { message } };
  }
}
