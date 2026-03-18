import { supabase } from "../supabase";
import { useMatchStore } from "@/stores/matchStore";
import { logger } from "@/utils/logger";
import type { Match } from "@/types";

const PAGE_SIZE = 50;

/**
 * Fetch the first page of matches for the current user from the server.
 * Merges with locally persisted matches (deduplicates by matchId).
 * Uses the get_matched_instagram_handles RPC to securely fetch handles
 * (profiles RLS only allows reading own row, so the old join returned null).
 *
 * Returns true if there are more matches to load, false otherwise.
 */
export async function fetchMatchesFromServer(): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      logger.warn("fetchMatchesFromServer: no user");
      return false;
    }

    const { data, error } = await supabase
      .from("matches")
      .select("id, user_a, user_b, created_at")
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (error) {
      logger.error("fetchMatchesFromServer error", error);
      return false;
    }

    if (!data || data.length === 0) {
      // Server returned zero matches — remove all local matches that are
      // ghosts (removed by the other party while we were offline).
      const store = useMatchStore.getState();
      if (store.matchesById.size > 0) {
        store.clearMatches();
        logger.wave("Cleared all local matches (server has none)");
      }
      return false;
    }

    await mergeServerMatches(data, user.id, true);

    return data.length === PAGE_SIZE;
  } catch (err) {
    logger.error("fetchMatchesFromServer exception", err);
    return false;
  }
}

/**
 * Load the next page of matches older than the given cursor timestamp.
 * Returns true if there are more matches to load.
 */
export async function loadMoreMatches(beforeCursor: string): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return false;

    const { data, error } = await supabase
      .from("matches")
      .select("id, user_a, user_b, created_at")
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
      .lt("created_at", beforeCursor)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (error) {
      logger.error("loadMoreMatches error", error);
      return false;
    }

    if (!data || data.length === 0) return false;

    await mergeServerMatches(data, user.id, false);

    return data.length === PAGE_SIZE;
  } catch (err) {
    logger.error("loadMoreMatches exception", err);
    return false;
  }
}

/**
 * Shared logic: fetch handles and merge a page of server matches into the store.
 *
 * When `isFirstPage` is true, also reconciles ghost matches — local matches
 * that no longer exist on the server (e.g., removed by the other party while
 * this user was offline). Only matches within the time range of the server
 * response are reconciled to avoid removing matches on later pages.
 */
async function mergeServerMatches(
  data: { id: string; user_a: string; user_b: string; created_at: string }[],
  userId: string,
  isFirstPage: boolean,
): Promise<void> {
  // Fetch contact handles via authenticated RPC
  const matchIds = data.map((row) => row.id);
  const { data: handleRows, error: handleError } = await supabase.rpc(
    "get_matched_contact_handles",
    { p_match_ids: matchIds },
  );

  const handleMap = new Map<string, { instagram?: string; snapchat?: string }>();
  if (!handleError && handleRows) {
    for (const row of handleRows as { match_id: string; instagram_handle: string | null; snapchat_handle: string | null }[]) {
      const handles: { instagram?: string; snapchat?: string } = {};
      if (row.instagram_handle) handles.instagram = row.instagram_handle;
      if (row.snapchat_handle) handles.snapchat = row.snapchat_handle;
      if (handles.instagram || handles.snapchat) {
        handleMap.set(row.match_id, handles);
      }
    }
  } else if (handleError) {
    logger.error("Failed to fetch match contact handles via RPC", handleError);
  }

  const store = useMatchStore.getState();
  const existingIds = new Set(Array.from(store.matchesById.keys()));

  const serverMatches: Match[] = data
    .filter((row) => !existingIds.has(row.id))
    .map((row) => {
      const isUserA = row.user_a === userId;
      const matchedUserId = isUserA ? row.user_b : row.user_a;

      // Mark as unseen only if this is a recent match (< 5 min old) that the
      // user hasn't seen yet. This triggers the celebration screen for matches
      // that arrived while the app was closed, without flooding the user with
      // celebrations for old matches after a fresh install or data clear.
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      const isRecent = ageMs < 5 * 60_000; // 5 minutes

      return {
        matchId: row.id,
        matchedUserId,
        instagramHandle: handleMap.get(row.id)?.instagram,
        snapchatHandle: handleMap.get(row.id)?.snapchat,
        createdAt: row.created_at,
        seen: !(isFirstPage && isRecent),
      };
    });

  if (serverMatches.length > 0) {
    for (const match of serverMatches) {
      store.addMatch(match);
    }
    logger.wave("Merged server matches into store", {
      count: serverMatches.length,
    });
  }

  // Also update handles for existing matches that may have been missing
  for (const row of data) {
    const handles = handleMap.get(row.id);
    if (handles) {
      const existing = store.matchesById.get(row.id);
      if (existing) {
        const updates: { instagramHandle?: string; snapchatHandle?: string } = {};
        if (handles.instagram && !existing.instagramHandle) updates.instagramHandle = handles.instagram;
        if (handles.snapchat && !existing.snapchatHandle) updates.snapchatHandle = handles.snapchat;
        if (updates.instagramHandle || updates.snapchatHandle) {
          store.updateMatchHandles(row.id, updates);
        }
      }
    }
  }

  // Reconcile ghost matches: remove local matches that the server no longer has.
  // Only run on the first page to avoid false removals from later pages.
  // Use `existingIds` (snapshot taken BEFORE addMatch calls above) to avoid
  // removing matches that arrived via Realtime during this async function.
  if (isFirstPage) {
    const serverMatchIds = new Set(data.map((row) => row.id));
    const isFullPage = data.length === PAGE_SIZE;

    // If server returned a full page, we only know about matches down to the
    // oldest returned timestamp. Local matches older than that could be on
    // page 2+ and should NOT be removed. If the page is partial (< PAGE_SIZE),
    // we have ALL the user's matches — anything local not in the set is a ghost.
    const oldestServerTimestamp = isFullPage
      ? data[data.length - 1].created_at
      : null;

    const ghostIds: string[] = [];

    // Only check matches that existed BEFORE this merge started (existingIds).
    // Matches added during merge (by Realtime or addMatch above) are NOT
    // candidates for ghost removal — they're fresh data, not stale ghosts.
    for (const localId of existingIds) {
      if (serverMatchIds.has(localId)) continue; // exists on server
      const local = store.matchesById.get(localId);
      if (!local) continue; // already removed
      if (oldestServerTimestamp && local.createdAt < oldestServerTimestamp) continue; // older than page range
      ghostIds.push(localId);
    }

    if (ghostIds.length > 0) {
      for (const id of ghostIds) {
        useMatchStore.getState().removeMatch(id);
      }
      logger.wave("Removed ghost matches not found on server", {
        count: ghostIds.length,
      });
    }
  }
}
