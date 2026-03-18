import { useMemo } from "react";
import { useBleStore } from "@/stores/bleStore";
import { useMatchStore } from "@/stores/matchStore";

/**
 * Returns a Set of matchedUserIds that are currently within BLE range.
 * Used to show "Still Nearby" indicators on match history and celebration screen.
 *
 * Reactive: re-computes when nearbyPeers or matches change.
 */
export function useNearbyMatchIds(): Set<string> {
  const nearbyPeers = useBleStore((s) => s.nearbyPeers);
  const matches = useMatchStore((s) => s.getMatchesArray());

  return useMemo(() => {
    // Build set of user IDs currently on the radar
    const nearbyUserIds = new Set<string>();
    for (const peer of nearbyPeers.values()) {
      if (peer.userId) {
        nearbyUserIds.add(peer.userId);
      }
    }

    // Intersect with matched user IDs
    const nearbyMatchIds = new Set<string>();
    for (const match of matches) {
      if (nearbyUserIds.has(match.matchedUserId)) {
        nearbyMatchIds.add(match.matchedUserId);
      }
    }

    return nearbyMatchIds;
  }, [nearbyPeers, matches]);
}
