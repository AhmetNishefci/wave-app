import { useState, useCallback, useRef, useEffect } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { useBleStore } from "@/stores/bleStore";
import { useTokenStore } from "@/stores/tokenStore";
import { useAuthStore } from "@/stores/authStore";
import { waveBleManager } from "@/services/ble/bleManager";
import { showPermissionBlockedAlert } from "@/services/ble/permissions";
import { getCurrentLocation, updateLocationOnServer } from "@/services/location";
import { impactLight } from "@/utils/haptics";
import { logger } from "@/utils/logger";

export function useRadarDiscovery() {
  const { t } = useTranslation();
  const adapterState = useBleStore((s) => s.adapterState);
  const isDiscoveryActive = useBleStore((s) => s.isDiscoveryActive);
  const permissionStatus = useBleStore((s) => s.permissionStatus);
  const proximityAlertPending = useBleStore((s) => s.proximityAlertPending);
  const peerCount = useBleStore((s) => s.nearbyPeers.size);

  const [isStarting, setIsStarting] = useState(false);
  const startingRef = useRef(false);
  const [showProximityHint, setShowProximityHint] = useState(false);

  const handleStartDiscovery = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setIsStarting(true);
    try {
      const result = await waveBleManager.requestPermissions();
      if (result === "blocked") {
        showPermissionBlockedAlert();
        return;
      }
      if (result !== "granted") {
        Alert.alert(
          t("radar.permissionsRequired"),
          t("radar.permissionsBody"),
        );
        return;
      }

      let token = useTokenStore.getState().currentToken;
      if (!token) {
        for (let i = 0; i < 16; i++) {
          await new Promise((r) => setTimeout(r, 500));
          token = useTokenStore.getState().currentToken;
          if (token) break;
        }
      }

      if (!token) {
        Alert.alert(
          t("radar.connectionIssue"),
          t("radar.connectionIssueBody"),
        );
        return;
      }

      await waveBleManager.start();
      impactLight();

      // Send location to server for proximity notifications (non-blocking)
      const nearbyAlertsEnabled = useAuthStore.getState().nearbyAlertsEnabled;
      if (nearbyAlertsEnabled) {
        getCurrentLocation().then((loc) => {
          if (loc) {
            updateLocationOnServer(loc.latitude, loc.longitude).catch((err) =>
              logger.warn("Location update failed (non-fatal)", err),
            );
          }
        });
      }
    } catch (err) {
      logger.error("Failed to start discovery", err);
      Alert.alert(t("common.error"), t("radar.bluetoothError"));
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  }, [t]);

  const handleStopDiscovery = useCallback(async () => {
    await waveBleManager.stop();
  }, []);

  // Auto-resume: if Bluetooth is already PoweredOn (permissions granted in
  // a previous session), skip the PermissionGate and start discovery
  // automatically. The user should only see the gate on their very first
  // app open or if they revoked permissions in iOS Settings.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (
      !autoStarted.current &&
      !isDiscoveryActive &&
      !startingRef.current &&
      adapterState === "PoweredOn" &&
      permissionStatus !== "granted"
    ) {
      autoStarted.current = true;
      useBleStore.getState().setPermissionStatus("granted");
      handleStartDiscovery();
    }
  }, [adapterState, isDiscoveryActive, permissionStatus, handleStartDiscovery]);

  // Auto-start discovery when opened from a proximity alert notification
  useEffect(() => {
    if (proximityAlertPending) {
      useBleStore.getState().setProximityAlertPending(false);
      setShowProximityHint(true);
      if (!isDiscoveryActive && !startingRef.current && permissionStatus === "granted") {
        handleStartDiscovery();
      }
    }
  }, [proximityAlertPending, isDiscoveryActive, permissionStatus, handleStartDiscovery]);

  // Clear the hint once peers appear
  useEffect(() => {
    if (showProximityHint && peerCount > 0) {
      setShowProximityHint(false);
    }
  }, [showProximityHint, peerCount]);

  // Show permission gate only if the user genuinely hasn't granted permissions.
  // Skip the gate while adapter is initializing ("Unknown"), already on
  // ("PoweredOn"), or off but previously authorized ("PoweredOff" — show
  // the BleStatusBar "Bluetooth is off" message instead). Only show the
  // gate for "Unauthorized" (permissions denied) or "Unsupported".
  const showGate = permissionStatus !== "granted"
    && !isDiscoveryActive
    && adapterState !== "PoweredOn"
    && adapterState !== "PoweredOff"
    && adapterState !== "Unknown"
    && adapterState !== "Resetting";

  return {
    isStarting,
    showProximityHint,
    showGate,
    isDiscoveryActive,
    handleStartDiscovery,
    handleStopDiscovery,
  };
}
