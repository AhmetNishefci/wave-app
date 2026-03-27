import { Platform, PermissionsAndroid, Linking, Alert } from "react-native";
import { BleManager } from "react-native-ble-plx";
import type { BlePermissionStatus } from "@/types";
import { logger } from "@/utils/logger";

/**
 * Request all BLE-related permissions for the current platform.
 * Returns the overall permission status.
 */
export async function requestBlePermissions(
  bleManager: BleManager,
): Promise<BlePermissionStatus> {
  if (Platform.OS === "ios") {
    return requestIOSPermissions(bleManager);
  }
  return requestAndroidPermissions();
}

async function requestIOSPermissions(
  bleManager: BleManager,
): Promise<BlePermissionStatus> {
  // On iOS, calling onStateChange triggers the system Bluetooth permission dialog.
  // We wait for a definitive state before resolving. If the user is slow to respond,
  // we keep waiting (up to 60s) so we don't miss the permission grant.
  return new Promise((resolve) => {
    let resolved = false;

    const sub = bleManager.onStateChange((state) => {
      if (resolved) return;

      if (state === "PoweredOn") {
        resolved = true;
        sub.remove();
        resolve("granted");
      } else if (state === "Unauthorized") {
        resolved = true;
        sub.remove();
        resolve("denied");
      } else if (state === "PoweredOff") {
        resolved = true;
        sub.remove();
        // BLE permission is granted but the radio is off.
        // The adapter state listener in bleManager will handle
        // resuming when the user turns Bluetooth on.
        resolve("granted");
      }
      // "Unknown" and "Resetting" states are transient — keep waiting.
    }, true);

    // Safety timeout — 60s is generous enough for system dialog interaction
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        sub.remove();
        resolve("unknown");
      }
    }, 60_000);
  });
}

async function requestAndroidPermissions(): Promise<BlePermissionStatus> {
  const apiLevel = Platform.Version as number;

  try {
    if (apiLevel >= 31) {
      // Android 12+ requires granular BLE permissions
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);

      const allGranted = Object.values(results).every(
        (v) => v === PermissionsAndroid.RESULTS.GRANTED,
      );

      if (allGranted) return "granted";

      const anyDenied = Object.values(results).some(
        (v) => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
      );

      return anyDenied ? "blocked" : "denied";
    } else {
      // Pre-Android 12: just need location
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: "Location Permission",
          message:
            "Wave needs location permission to discover nearby Bluetooth devices.",
          buttonPositive: "Allow",
        },
      );

      if (result === PermissionsAndroid.RESULTS.GRANTED) return "granted";
      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)
        return "blocked";
      return "denied";
    }
  } catch (error) {
    logger.warn("Permission request failed (user can retry)", error);
    return "denied";
  }
}

/**
 * Show alert directing user to system settings when permissions are blocked.
 */
export function showPermissionBlockedAlert(): void {
  Alert.alert(
    "Permissions Required",
    "Wave needs Bluetooth permissions to discover nearby people. Please enable them in Settings.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Open Settings", onPress: () => Linking.openSettings() },
    ],
  );
}
