import { BleManager, Device } from "react-native-ble-plx";
import { Platform } from "react-native";
import {
  WAVE_SERVICE_UUID,
  WAVE_TOKEN_CHAR_UUID,
  LOCAL_NAME_PREFIX,
  GATT_CONNECT_TIMEOUT_MS,
  GATT_READ_COOLDOWN_MS,
} from "./constants";
import { parseBlePayload, type BlePayload } from "./parsePayload";
import { useBleStore } from "@/stores/bleStore";
import type { NearbyPeer, Gender } from "@/types";
import { logger } from "@/utils/logger";

// Cap concurrent GATT connections to avoid exhausting iOS limit (M8 fix)
const MAX_CONCURRENT_GATT = 4;
const UPSERT_BATCH_MS = 300;
const MAX_GATT_QUEUE = 20; // Cap queued GATT reads to avoid unbounded growth
const MAX_PENDING_UPSERTS = 100; // Force flush when batch gets large (F4 fix)
/** EMA smoothing factor for RSSI. 0.3 = balanced (dampens jitter, reflects real movement in ~2-3s) */
const RSSI_SMOOTHING_ALPHA = 0.3;
const MAX_PEERS = 200; // Must match bleStore cap — enforced here for batch path (B2 fix)

/**
 * Scanner session state — isolated per BLE session to prevent leaks
 * across login/logout cycles. Each call to startScanning() binds the
 * session; resetScannerState() clears it on destroy.
 */
interface ScannerSession {
  pendingGattReads: Set<string>;
  gattQueue: Device[]; // Queued devices waiting for a GATT slot
  recentGattReads: Map<string, number>;
  /** Maps BLE device ID → last known ephemeral token for same-device dedup */
  deviceToToken: Map<string, string>;
  pendingUpserts: NearbyPeer[];
  upsertTimer: ReturnType<typeof setTimeout> | null;
  bleManager: BleManager | null;
}

let session: ScannerSession = createFreshSession();

function createFreshSession(): ScannerSession {
  return {
    pendingGattReads: new Set(),
    gattQueue: [],
    recentGattReads: new Map(),
    deviceToToken: new Map(),
    pendingUpserts: [],
    upsertTimer: null,
    bleManager: null,
  };
}

/**
 * Extract the ephemeral token, gender, and age from a device's local name.
 * Strips the "E:" prefix, then delegates to the shared parser.
 */
function extractPayload(device: Device): BlePayload | null {
  const name = device.localName ?? device.name;
  if (!name || !name.startsWith(LOCAL_NAME_PREFIX)) return null;
  return parseBlePayload(name.slice(LOCAL_NAME_PREFIX.length));
}

/**
 * Start scanning for nearby Wave devices.
 * In foreground: tokens are read from the advertisement local name.
 * In background: tokens are read via GATT connection (iOS strips local name).
 */
export function startScanning(bleManager: BleManager): void {
  const store = useBleStore.getState();
  session.bleManager = bleManager;

  if (store.isScanning) {
    logger.ble("Already scanning, skipping");
    return;
  }

  // Clear error on successful scan start (H9 fix)
  useBleStore.setState({ isScanning: true, error: null });
  logger.ble("Starting BLE scan for Wave devices");

  bleManager.startDeviceScan(
    [WAVE_SERVICE_UUID],
    { allowDuplicates: true },
    (error, device) => {
      if (error) {
        // BLE reset/PoweredOff are transient iOS events — the adapter recovers
        // automatically via onStateChange → resume(). Don't send to Sentry.
        const isTransient = error.message?.includes("resetting") || error.message?.includes("powered off");
        if (isTransient) {
          logger.warn("Scan interrupted (transient)", error.message);
        } else {
          logger.warn("Scan error (user must restart discovery)", error);
        }
        useBleStore.setState({ error: error.message, isScanning: false });
        return;
      }

      if (!device) return;

      handleDiscoveredDevice(device);
    },
  );
}

/**
 * Flush any pending peer upserts immediately. Shared by stopScanning
 * (H10 fix) and the batch cap guard (F4 fix) to avoid code duplication.
 */
function flushPendingUpserts(): void {
  if (session.upsertTimer) {
    clearTimeout(session.upsertTimer);
    session.upsertTimer = null;
  }
  if (session.pendingUpserts.length === 0) return;

  const batch = session.pendingUpserts;
  session.pendingUpserts = [];
  useBleStore.setState((state) => {
    const next = new Map(state.nearbyPeers);
    for (const p of batch) {
      const existing = next.get(p.ephemeralToken);
      if (existing) {
        // EMA smoothing: blend new RSSI with previous to dampen zone-boundary jitter
        next.set(p.ephemeralToken, {
          ...p,
          rssi: Math.round(RSSI_SMOOTHING_ALPHA * p.rssi + (1 - RSSI_SMOOTHING_ALPHA) * existing.rssi),
        });
      } else {
        next.set(p.ephemeralToken, p);
      }
    }

    // Enforce peer cap: evict weakest-signal peers if batch pushed us over.
    // Mirrors the eviction logic in bleStore.upsertPeer (B2 fix).
    while (next.size > MAX_PEERS) {
      let weakestToken: string | null = null;
      let weakestRssi = Infinity;
      for (const [token, p] of next) {
        if (p.rssi < weakestRssi) {
          weakestRssi = p.rssi;
          weakestToken = token;
        }
      }
      if (weakestToken) next.delete(weakestToken);
      else break;
    }

    return { nearbyPeers: next };
  });
}

export function stopScanning(bleManager: BleManager): void {
  bleManager.stopDeviceScan();

  // Flush pending upserts before clearing, so recently-discovered peers
  // are not silently dropped (H10 fix)
  flushPendingUpserts();

  useBleStore.setState({ isScanning: false });
  logger.ble("Stopped BLE scan");
}

/** Prune stale entries from the GATT read cooldown map */
export function pruneGattReadCache(): void {
  const now = Date.now();
  for (const [id, ts] of session.recentGattReads) {
    if (now - ts > GATT_READ_COOLDOWN_MS * 3) {
      session.recentGattReads.delete(id);
    }
  }
}

/**
 * Reset module-level state. Called when the BLE manager is destroyed
 * to prevent stale references across sessions (H8 fix).
 */
export function resetScannerState(): void {
  if (session.upsertTimer) {
    clearTimeout(session.upsertTimer);
  }
  session = createFreshSession();
}

function handleDiscoveredDevice(device: Device): void {
  const payload = extractPayload(device);

  if (payload) {
    // Fast path: got token from local name (foreground advertising)
    upsertPeerWithToken(device, payload.token, payload.gender, payload.age);
    return;
  }

  // Slow path: no local name — device is likely backgrounded on iOS.
  // Connect via GATT to read the token characteristic.
  if (Platform.OS === "ios" && session.bleManager) {
    attemptGattTokenRead(device);
  }
}

function upsertPeerWithToken(device: Device, token: string, gender: Gender | null, age: number | null = null): void {
  const deviceId = device.id;
  const rssi = device.rssi ?? -100;
  const now = Date.now();

  // Dedup: if this device was previously advertising a different token (e.g., user
  // killed and reopened the app), remove the old token's peer entry immediately.
  const previousToken = session.deviceToToken.get(deviceId);
  if (previousToken && previousToken !== token) {
    useBleStore.getState().removePeer(previousToken);
  }
  session.deviceToToken.set(deviceId, token);

  const existing = useBleStore.getState().nearbyPeers.get(token);

  const peer: NearbyPeer = {
    deviceBleId: deviceId,
    ephemeralToken: token,
    rssi,
    lastSeen: now,
    discoveredAt: existing?.discoveredAt ?? now,
    gender: gender ?? existing?.gender ?? null,
    age: age ?? existing?.age ?? null,
    note: existing?.note ?? null,
    userId: existing?.userId ?? null,
    genderPreference: existing?.genderPreference ?? null,
    agePreferenceMin: existing?.agePreferenceMin ?? null,
    agePreferenceMax: existing?.agePreferenceMax ?? null,
  };

  // Batch upserts to avoid creating a new Map on every BLE advertisement.
  // Force-flush when batch hits cap to prevent unbounded growth (F4 fix).
  session.pendingUpserts.push(peer);
  if (session.pendingUpserts.length >= MAX_PENDING_UPSERTS) {
    flushPendingUpserts();
  } else if (!session.upsertTimer) {
    session.upsertTimer = setTimeout(flushPendingUpserts, UPSERT_BATCH_MS);
  }

  if (!existing) {
    logger.ble(`Discovered peer: ${token.substring(0, 8)}...`, { rssi, gender, age });
  }
}

/**
 * Connect to a discovered device via GATT to read its ephemeral token.
 * Used when the device is advertising in background mode and iOS has
 * stripped the local name from the advertising packet.
 * Queues the read if at concurrent cap, and drains queue when slots open.
 */
async function attemptGattTokenRead(device: Device): Promise<void> {
  const deviceId = device.id;

  // Skip if already in-progress or recently attempted
  if (session.pendingGattReads.has(deviceId)) return;
  const lastRead = session.recentGattReads.get(deviceId);
  if (lastRead && Date.now() - lastRead < GATT_READ_COOLDOWN_MS) return;

  // Queue if at concurrent cap (M8 fix + queue improvement)
  if (session.pendingGattReads.size >= MAX_CONCURRENT_GATT) {
    if (session.gattQueue.some((d) => d.id === deviceId)) return;

    if (session.gattQueue.length < MAX_GATT_QUEUE) {
      session.gattQueue.push(device);
      logger.ble(`GATT read queued (${session.gattQueue.length}/${MAX_GATT_QUEUE}): ${deviceId.substring(0, 8)}`);
    } else {
      // Queue full — evict weakest-signal device if new device is closer (V2 fix).
      // Mirrors the peer cap eviction pattern in bleStore/flushPendingUpserts.
      // Ensures closest peers get GATT reads first in crowded venues.
      const newRssi = device.rssi ?? -100;
      let weakestIdx = 0;
      let weakestRssi = session.gattQueue[0]?.rssi ?? -100;
      for (let i = 1; i < session.gattQueue.length; i++) {
        const rssi = session.gattQueue[i]?.rssi ?? -100;
        if (rssi < weakestRssi) {
          weakestRssi = rssi;
          weakestIdx = i;
        }
      }
      if (newRssi > weakestRssi) {
        logger.ble(`GATT queue evict (rssi ${weakestRssi} → ${newRssi}): ${deviceId.substring(0, 8)}`);
        session.gattQueue[weakestIdx] = device;
      }
    }
    return;
  }

  session.pendingGattReads.add(deviceId);

  // Capture manager reference at call time to detect staleness (H7 fix)
  const manager = session.bleManager;
  if (!manager) {
    session.pendingGattReads.delete(deviceId);
    return;
  }

  try {
    const connected = await manager.connectToDevice(deviceId, {
      timeout: GATT_CONNECT_TIMEOUT_MS,
    });

    await connected.discoverAllServicesAndCharacteristics();

    const chars = await connected.characteristicsForService(WAVE_SERVICE_UUID);
    const tokenChar = chars?.find(
      (c) => c.uuid.toUpperCase() === WAVE_TOKEN_CHAR_UUID.toUpperCase(),
    );

    if (tokenChar) {
      const read = await tokenChar.read();
      if (read.value) {
        // react-native-ble-plx returns base64-encoded data
        // Use atob (available on Hermes 0.71+); no Buffer in React Native
        try {
          const decoded = atob(read.value);
          const payload = parseBlePayload(decoded);
          if (payload) {
            logger.ble(
              `GATT read token: ${payload.token.substring(0, 8)}... from ${deviceId.substring(0, 8)}`,
            );
            upsertPeerWithToken(device, payload.token, payload.gender, payload.age);
          } else {
            logger.ble(`GATT read invalid token format from ${deviceId.substring(0, 8)}: len=${decoded.length}`);
          }
        } catch (decodeErr) {
          // atob can fail on non-Latin-1 binary data (M14 fix)
          logger.ble(`GATT decode failed for ${deviceId.substring(0, 8)}: ${decodeErr}`);
        }
      }
    }

    session.recentGattReads.set(deviceId, Date.now());
  } catch (error) {
    logger.ble(`GATT read failed for ${deviceId.substring(0, 8)}: ${error}`);
    session.recentGattReads.set(deviceId, Date.now());
  } finally {
    session.pendingGattReads.delete(deviceId);
    // Always disconnect to prevent connection leaks (C6 fix)
    try {
      if (manager) {
        await manager.cancelDeviceConnection(deviceId);
      }
    } catch {
      // Ignore disconnect errors — device may already be disconnected
    }

    // Drain queue: process next queued device now that a slot is free
    if (session.gattQueue.length > 0 && session.pendingGattReads.size < MAX_CONCURRENT_GATT) {
      const next = session.gattQueue.shift();
      if (next) {
        attemptGattTokenRead(next);
      }
    }
  }
}
