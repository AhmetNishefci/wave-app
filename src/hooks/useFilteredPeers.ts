import { useMemo } from "react";
import { useBleStore } from "@/stores/bleStore";
import { useWaveStore } from "@/stores/waveStore";
import { useMatchStore } from "@/stores/matchStore";
import { useAuthStore } from "@/stores/authStore";
import type { NearbyPeer } from "@/types";

const PEER_DISPLAY_CAP = 50;

export function useFilteredPeers(showAllPeers: boolean) {
  const {
    nearbyPeers,
    blockedUserIds,
  } = useBleStore();
  const rawIncomingWaveTokens = useWaveStore((s) => s.incomingWaveTokens);
  const matchesById = useMatchStore((s) => s.matchesById);
  const myGender = useAuthStore((s) => s.gender);
  const myAge = useAuthStore((s) => s.age);
  const genderPreference = useAuthStore((s) => s.genderPreference);
  const agePreferenceMin = useAuthStore((s) => s.agePreferenceMin);
  const agePreferenceMax = useAuthStore((s) => s.agePreferenceMax);

  // Filter peers by mutual preferences — both users must match each other's criteria.
  // This prevents one-sided visibility where A sees B but B can't see A.
  const filteredPeers = useMemo(() => {
    const filtered = new Map<string, NearbyPeer>();
    const seenUserIds = new Map<string, string>(); // userId → token (for dedup)
    const filterGender = genderPreference && genderPreference !== "both";
    const filterAge = agePreferenceMin != null && agePreferenceMax != null;

    for (const [token, peer] of nearbyPeers) {
      // Resolution gate: only show peers whose userId has been resolved.
      // This guarantees zero duplicates (dedup by userId is reliable) and
      // ensures all filters (block, match, preference) work immediately.
      // Peers appear ~1s after BLE discovery (fast resolution tick).
      if (!peer.userId) continue;

      // Block filter: hide peers whose userId is in the blocked set
      if (blockedUserIds.has(peer.userId)) {
        continue;
      }
      // Match filter: hide already-matched peers (they belong in History)
      {
        let isMatched = false;
        for (const m of matchesById.values()) {
          if (m.matchedUserId === peer.userId) { isMatched = true; break; }
        }
        if (isMatched) continue;
      }
      // Forward filter: does this peer match MY preferences?
      if (filterGender && peer.gender && peer.gender !== genderPreference) {
        continue;
      }
      if (filterAge && peer.age != null) {
        if (peer.age < agePreferenceMin || peer.age > agePreferenceMax) {
          continue;
        }
      }
      // Reverse filter: do I match THIS PEER's preferences?
      // Only apply when the peer's preferences have been resolved from the server.
      if (peer.genderPreference && peer.genderPreference !== "both" && myGender) {
        if (myGender !== peer.genderPreference) {
          continue;
        }
      }
      if (peer.agePreferenceMin != null && peer.agePreferenceMax != null && myAge != null) {
        if (myAge < peer.agePreferenceMin || myAge > peer.agePreferenceMax) {
          continue;
        }
      }
      // Dedup by userId: if we already have a peer with this userId, keep the fresher one
      if (peer.userId) {
        const existingToken = seenUserIds.get(peer.userId);
        if (existingToken) {
          const existingPeer = filtered.get(existingToken)!;
          if (peer.lastSeen > existingPeer.lastSeen) {
            filtered.delete(existingToken);
            seenUserIds.set(peer.userId, token);
          } else {
            continue;
          }
        } else {
          seenUserIds.set(peer.userId, token);
        }
      }
      filtered.set(token, peer);
    }

    return filtered;
  }, [nearbyPeers, blockedUserIds, matchesById, myGender, myAge, genderPreference, agePreferenceMin, agePreferenceMax]);

  // Only count incoming waves from wavers still visible on the radar
  // AND matching gender preference (prevent phantom wave notifications).
  const incomingWaveTokens = useMemo(
    () => rawIncomingWaveTokens.filter((t) => filteredPeers.has(t)),
    [rawIncomingWaveTokens, filteredPeers],
  );

  const sortedPeers = useMemo<NearbyPeer[]>(() => {
    const peers = Array.from(filteredPeers.values());
    const incomingSet = new Set(rawIncomingWaveTokens);

    // Sort: incoming wavers first, then by discovery time (stable order — no jumping)
    peers.sort((a, b) => {
      const aPriority = incomingSet.has(a.ephemeralToken) ? 1 : 0;
      const bPriority = incomingSet.has(b.ephemeralToken) ? 1 : 0;
      if (aPriority !== bPriority) return bPriority - aPriority;
      return a.discoveredAt - b.discoveredAt;
    });

    if (!showAllPeers && peers.length > PEER_DISPLAY_CAP) {
      return peers.slice(0, PEER_DISPLAY_CAP);
    }

    return peers;
  }, [filteredPeers, showAllPeers, rawIncomingWaveTokens]);

  return {
    filteredPeers,
    sortedPeers,
    incomingWaveTokens,
    totalPeers: filteredPeers.size,
  };
}
