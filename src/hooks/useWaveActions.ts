import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { impactMedium, impactLight, notifySuccess, notifyError } from "@/utils/haptics";
import { useWaveStore } from "@/stores/waveStore";
import { useMatchStore } from "@/stores/matchStore";
import { useBleStore } from "@/stores/bleStore";
import { sendWave, undoWave } from "@/services/wave/waves";
import { playWaveSent } from "@/utils/sound";
import { logger } from "@/utils/logger";
import { clearWaveStateForUser } from "@/utils/waveCleanup";
import type { NearbyPeer } from "@/types";

type SetToast = (toast: { message: string; variant?: "success" | "error" } | null) => void;

export function useWaveActions(setToast: SetToast) {
  const { t } = useTranslation();

  const handleWave = useCallback(async (peer: NearbyPeer) => {
    const store = useWaveStore.getState();
    if (store.hasPendingWaveTo(peer.ephemeralToken)) return;
    if (store.wavingBackTokens.has(peer.ephemeralToken)) return;

    // Detect wave-back: the user is responding to someone who waved at them.
    // In this case we skip the optimistic "Undo" state — the intent is to
    // match, not to start a pending wave. Show a loading state instead.
    const isWaveBack = store.incomingWaveTokens.includes(peer.ephemeralToken);

    impactMedium();
    playWaveSent();

    if (isWaveBack) {
      store.addWavingBack(peer.ephemeralToken);
    } else {
      store.addPendingWave(peer.ephemeralToken);
    }

    logger.wave("Sending wave to peer", {
      token: peer.ephemeralToken.substring(0, 8),
      isWaveBack,
    });

    const result = await sendWave(peer.ephemeralToken);
    if (isWaveBack) store.removeWavingBack(peer.ephemeralToken);

    if (result.status === "expired_token") {
      // The peer's token rotated since we discovered them. If we know their
      // userId, find their fresh token in nearbyPeers and retry once (V4 fix).
      if (!isWaveBack) store.removePendingWave(peer.ephemeralToken);
      if (peer.userId) {
        const peers = useBleStore.getState().nearbyPeers;
        let freshToken: string | null = null;
        for (const [token, p] of peers) {
          if (p.userId === peer.userId && token !== peer.ephemeralToken) {
            freshToken = token;
            break;
          }
        }
        if (freshToken) {
          logger.wave("Retrying wave with fresh token after expired_token", {
            old: peer.ephemeralToken.substring(0, 8),
            fresh: freshToken.substring(0, 8),
          });
          if (!isWaveBack) store.addPendingWave(freshToken);
          const retry = await sendWave(freshToken);
          if (retry.status === "pending") {
            if (!isWaveBack) {
              if (retry.targetUserId) {
                useMatchStore.getState().setPendingWaveUser(retry.targetUserId, freshToken);
              }
            }
            setToast({ message: t("radar.waveSentToast") });
            return;
          } else if (retry.status === "match" && retry.match) {
            if (!isWaveBack) store.removePendingWave(freshToken);
            useMatchStore.getState().addMatch(retry.match);
            useMatchStore.getState().addMatchedToken(freshToken, {
              instagram: retry.match.instagramHandle,
              snapchat: retry.match.snapchatHandle,
            });
            notifySuccess();
            return;
          }
          logger.warn("Retry after expired_token also failed", {
            retryStatus: retry.status,
            freshToken: freshToken.substring(0, 8),
          });
          if (!isWaveBack) store.removePendingWave(freshToken);
        } else {
          logger.warn("No fresh token found for expired_token retry", {
            userId: peer.userId,
            expiredToken: peer.ephemeralToken.substring(0, 8),
          });
        }
      }
      notifyError();
      setToast({ message: t("radar.couldntWave"), variant: "error" });
    } else if (result.status === "error") {
      if (!isWaveBack) store.removePendingWave(peer.ephemeralToken);
      notifyError();
      setToast({ message: t("radar.couldntWave"), variant: "error" });
    } else if (result.status === "already_matched") {
      if (!isWaveBack) store.removePendingWave(peer.ephemeralToken);
      if (result.match) useMatchStore.getState().addMatch(result.match);
      useMatchStore.getState().addMatchedToken(peer.ephemeralToken, {
        instagram: result.match?.instagramHandle,
        snapchat: result.match?.snapchatHandle,
      });
      setToast({ message: t("radar.alreadyMatchedToast") });
    } else if (result.status === "rate_limited") {
      if (!isWaveBack) store.removePendingWave(peer.ephemeralToken);
      notifyError();
      setToast({ message: t("radar.waveTooFast"), variant: "error" });
    } else if (result.status === "blocked") {
      if (!isWaveBack) store.removePendingWave(peer.ephemeralToken);
      // Remove blocked peer from radar immediately and prevent flicker on BLE rediscovery
      useBleStore.getState().removePeer(peer.ephemeralToken);
      if (peer.userId) useBleStore.getState().addBlockedUserId(peer.userId);
      setToast({ message: t("radar.blockedWave"), variant: "error" });
    } else if (result.status === "match") {
      if (!isWaveBack) store.removePendingWave(peer.ephemeralToken);
      if (result.match) useMatchStore.getState().addMatch(result.match);
      useMatchStore.getState().addMatchedToken(peer.ephemeralToken, {
        instagram: result.match?.instagramHandle,
        snapchat: result.match?.snapchatHandle,
      });
      // Clean ALL wave state for the matched peer — this user completed the
      // match via HTTP response (not broadcast), so the cleanup in
      // realtime.ts doesn't fire here. Without this, removing the match
      // later would resurface "Wave back" or "Undo" from stale wave tokens.
      if (peer.userId) clearWaveStateForUser(peer.userId);
      notifySuccess();
      logger.wave("Match from wave!");
    } else if (result.status === "pending") {
      // Store userId → token mapping so realtime match events can bridge to radar
      if (result.targetUserId) {
        useMatchStore.getState().setPendingWaveUser(result.targetUserId, peer.ephemeralToken);
      }
      setToast({ message: t("radar.waveSentToast") });
    }
  }, [setToast, t]);

  const undoingRef = useRef<string | null>(null);
  const handleUndo = useCallback(async (targetToken: string) => {
    if (undoingRef.current === targetToken) return;
    undoingRef.current = targetToken;
    impactLight();
    const success = await undoWave(targetToken);
    undoingRef.current = null;
    if (success) {
      useWaveStore.getState().removePendingWave(targetToken);
      useMatchStore.getState().removePendingWaveByToken(targetToken);
      setToast({ message: t("radar.waveUndoneToast") });
    } else {
      notifyError();
      setToast({ message: t("radar.couldntUndo"), variant: "error" });
    }
  }, [setToast, t]);

  return { handleWave, handleUndo };
}
