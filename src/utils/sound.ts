import { Audio } from "expo-av";
import { logger } from "@/utils/logger";

/**
 * Sound effects utility — mirrors the haptics.ts pattern.
 * Sounds are preloaded on first use for instant playback.
 * Respects the device silent switch (playsInSilentModeIOS: false).
 * All functions fail silently so they never block UI.
 *
 * Sound files: CC0 licensed from Kenney (kenney.nl)
 */

let audioConfigured = false;
let waveSentPromise: Promise<Audio.Sound | null> | null = null;
let matchPromise: Promise<Audio.Sound | null> | null = null;

async function ensureAudioConfig(): Promise<void> {
  if (audioConfigured) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: false,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
    audioConfigured = true;
  } catch {
    // silently ignore
  }
}

function getWaveSentSound(): Promise<Audio.Sound | null> {
  if (!waveSentPromise) {
    waveSentPromise = (async () => {
      try {
        await ensureAudioConfig();
        const { sound } = await Audio.Sound.createAsync(
          require("../../assets/sounds/wave-sent.m4a"),
          { shouldPlay: false, volume: 0.5 },
        );
        return sound;
      } catch (err) {
        logger.warn("Failed to load wave-sent sound (non-fatal)", err);
        waveSentPromise = null; // allow retry on next call
        return null;
      }
    })();
  }
  return waveSentPromise;
}

function getMatchSound(): Promise<Audio.Sound | null> {
  if (!matchPromise) {
    matchPromise = (async () => {
      try {
        await ensureAudioConfig();
        const { sound } = await Audio.Sound.createAsync(
          require("../../assets/sounds/match.m4a"),
          { shouldPlay: false, volume: 0.7 },
        );
        return sound;
      } catch (err) {
        logger.warn("Failed to load match sound (non-fatal)", err);
        matchPromise = null; // allow retry on next call
        return null;
      }
    })();
  }
  return matchPromise;
}

export async function playWaveSent(): Promise<void> {
  try {
    const sound = await getWaveSentSound();
    if (!sound) return;
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch {
    // Sound became invalid (OS reclaimed resources while backgrounded).
    // Clear the cached promise so the next play attempt re-creates it.
    waveSentPromise = null;
  }
}

export async function playMatchChime(): Promise<void> {
  try {
    const sound = await getMatchSound();
    if (!sound) return;
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch {
    // Sound became invalid (OS reclaimed resources while backgrounded).
    // Clear the cached promise so the next play attempt re-creates it.
    matchPromise = null;
  }
}

/**
 * Preload all sound assets so the first playback is instant.
 * Call once during app initialization. Fails silently.
 */
export function preloadSounds(): void {
  getWaveSentSound();
  getMatchSound();
}
