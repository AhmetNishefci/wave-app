import { BleManager as PlxBleManager, State, Subscription } from "react-native-ble-plx";
import { Platform } from "react-native";
import { startScanning, stopScanning, pruneGattReadCache, resetScannerState } from "./scanner";
import {
  startAdvertising,
  stopAdvertising,
  updateAdvertisedToken,
  isPeripheralSupported,
} from "./advertiser";
import { requestBlePermissions } from "./permissions";
import { useBleStore } from "@/stores/bleStore";
import { useTokenStore } from "@/stores/tokenStore";
import { useAuthStore } from "@/stores/authStore";
import { SCAN_DURATION_MS, SCAN_PAUSE_MS } from "./constants";
import type { BleAdapterState } from "@/types";
import { genderToChar } from "@/types";
import { logger } from "@/utils/logger";

class WaveBleManager {
  private bleManager: PlxBleManager | null = null;
  private stateSubscription: Subscription | null = null;
  private scanCycleTimer: ReturnType<typeof setTimeout> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  /**
   * Initialize the BLE manager and request permissions.
   * Must be called before start().
   */
  async initialize(): Promise<void> {
    if (this.bleManager) return;

    // iOS state restoration key allows the system to relaunch the app
    // and restore the BLE manager state after a background termination.
    const options = Platform.OS === "ios"
      ? { restoreStateIdentifier: "wave-ble-central" }
      : undefined;
    this.bleManager = new PlxBleManager(options);
    logger.ble("BLE Manager initialized");

    // Listen for adapter state changes
    this.stateSubscription = this.bleManager.onStateChange((state) => {
      const mapped = this.mapState(state);
      useBleStore.getState().setAdapterState(mapped);
      logger.ble("Adapter state changed", { state: mapped });

      if (state === "PoweredOff" && this.isRunning) {
        this.pause();
      } else if (state === "PoweredOn" && this.isRunning) {
        this.resume();
      }
    }, true);
  }

  /**
   * Request BLE permissions from the user.
   */
  async requestPermissions(): Promise<"granted" | "denied" | "blocked"> {
    if (!this.bleManager) {
      await this.initialize();
    }

    const status = await requestBlePermissions(this.bleManager!);
    useBleStore.getState().setPermissionStatus(status);

    if (status === "granted") return "granted";
    if (status === "blocked") return "blocked";
    return "denied";
  }

  /**
   * Build the BLE payload string from the current token, gender, and age.
   * Format: "{genderChar}{age2digits}{token}" — native module prepends "E:" for local name.
   * Falls back to "{genderChar}{token}" if age is unavailable.
   */
  private buildPayload(token: string): string {
    const { gender, age } = useAuthStore.getState();
    if (gender && age != null) {
      const ageStr = String(Math.min(Math.max(age, 18), 99)).padStart(2, "0");
      return genderToChar(gender) + ageStr + token;
    }
    if (gender) {
      return genderToChar(gender) + token;
    }
    return token;
  }

  /**
   * Start the BLE engine: begin advertising and scanning.
   * Requires permissions to be granted and a token to advertise.
   */
  async start(): Promise<void> {
    if (this.isRunning) return; // TD-2: prevent double-start (timer leak)

    if (!this.bleManager) {
      throw new Error("BLE Manager not initialized. Call initialize() first.");
    }

    const { permissionStatus } = useBleStore.getState();
    if (permissionStatus !== "granted") {
      throw new Error("BLE permissions not granted.");
    }

    const token = useTokenStore.getState().currentToken;
    if (!token) {
      throw new Error("No ephemeral token available. Fetch one first.");
    }

    this.isRunning = true;
    logger.ble("Starting Wave BLE engine");

    // Start advertising with gender-prefixed payload (skip on platforms
    // where peripheral mode is not supported to avoid misleading UI state)
    try {
      if (await isPeripheralSupported()) {
        await startAdvertising(this.buildPayload(token));
        useBleStore.getState().setAdvertising(true);
      }
    } catch (error) {
      logger.error("Failed to start advertising", error);
      useBleStore.getState().setError("Failed to start advertising");
    }

    // Mark discovery active (stays true across scan cycles)
    useBleStore.getState().setDiscoveryActive(true);

    // Start scanning cycle
    this.startScanCycle();

    // Start peer pruning
    this.startPruning();
  }

  /**
   * Stop the BLE engine completely.
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    logger.ble("Stopping Wave BLE engine");

    this.stopScanCycle();
    this.stopPruning();

    if (this.bleManager) {
      stopScanning(this.bleManager);
    }

    try {
      await stopAdvertising();
    } catch {
      // Ignore
    }

    useBleStore.getState().setScanning(false);
    useBleStore.getState().setAdvertising(false);
    useBleStore.getState().setDiscoveryActive(false);
  }

  /**
   * Update the advertised token (called during rotation).
   */
  async rotateToken(newToken: string): Promise<void> {
    try {
      await updateAdvertisedToken(this.buildPayload(newToken));
      logger.ble("Token rotated");
    } catch (error) {
      logger.error("Token rotation failed", error);
    }
  }

  /**
   * Clean up resources.
   */
  async destroy(): Promise<void> {
    await this.stop();
    // Reset module-level scanner state to prevent stale references (H8 fix)
    resetScannerState();
    this.stateSubscription?.remove();
    this.bleManager?.destroy();
    this.bleManager = null;
    logger.ble("BLE Manager destroyed");
  }

  /**
   * Restart the scan cycle at full speed.
   * Called when the app returns to foreground after running in background.
   */
  restartScanCycle(): void {
    if (!this.bleManager || !this.isRunning) return;
    this.stopScanCycle();
    if (this.bleManager) {
      stopScanning(this.bleManager);
    }
    this.startScanCycle();
    logger.ble("Scan cycle restarted");
  }

  // --- Private methods ---

  private startScanCycle(): void {
    if (!this.bleManager || !this.isRunning) return;

    startScanning(this.bleManager);

    this.scanCycleTimer = setTimeout(() => {
      if (!this.bleManager || !this.isRunning) return;

      stopScanning(this.bleManager);

      // Pause, then restart
      this.scanCycleTimer = setTimeout(() => {
        this.startScanCycle();
      }, SCAN_PAUSE_MS);
    }, SCAN_DURATION_MS);
  }

  private stopScanCycle(): void {
    if (this.scanCycleTimer) {
      clearTimeout(this.scanCycleTimer);
      this.scanCycleTimer = null;
    }
  }

  private startPruning(): void {
    // Clear any existing timer to prevent leaks if called twice (TD-2 fix)
    this.stopPruning();
    this.pruneTimer = setInterval(() => {
      useBleStore.getState().pruneStale();
      pruneGattReadCache();
    }, 5_000); // Prune every 5 seconds
  }

  private stopPruning(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  private async pause(): Promise<void> {
    logger.ble("Pausing BLE engine (adapter off)");
    this.stopScanCycle();
    this.stopPruning();

    // Stop advertising when adapter goes off (H6 fix)
    try {
      await stopAdvertising();
    } catch {
      // Ignore — adapter is already off
    }
    useBleStore.getState().setScanning(false);
    useBleStore.getState().setAdvertising(false);
  }

  private async resume(): Promise<void> {
    logger.ble("Resuming BLE engine (adapter on)");

    // Stop existing timers first to prevent stacking if resume() is called
    // without an intervening pause() (e.g. Resetting → PoweredOn transition
    // where the Resetting state doesn't trigger pause). B1 fix.
    this.stopScanCycle();
    this.stopPruning();

    // Stop old advertisement and wait for completion before restarting (H6 fix)
    // This prevents overlapping advertising sessions from the pause/resume race
    const token = useTokenStore.getState().currentToken;
    if (token && await isPeripheralSupported()) {
      try {
        await stopAdvertising();
      } catch {
        // Ignore — adapter may already be stopped
      }
      try {
        await startAdvertising(this.buildPayload(token));
        useBleStore.getState().setAdvertising(true);
      } catch (err) {
        logger.error("Failed to restart advertising after resume", err);
      }
    }

    // Start scan cycle and pruning AFTER advertising is settled
    this.startScanCycle();
    this.startPruning();
  }

  private mapState(state: State): BleAdapterState {
    switch (state) {
      case State.Unknown:
        return "Unknown";
      case State.Resetting:
        return "Resetting";
      case State.Unsupported:
        return "Unsupported";
      case State.Unauthorized:
        return "Unauthorized";
      case State.PoweredOff:
        return "PoweredOff";
      case State.PoweredOn:
        return "PoweredOn";
      default:
        return "Unknown";
    }
  }
}

// Singleton instance
export const waveBleManager = new WaveBleManager();
