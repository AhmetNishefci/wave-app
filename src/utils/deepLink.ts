import { Linking } from "react-native";

/** Sanitize a social handle to prevent URL injection. */
function sanitizeHandle(handle: string): string {
  // Strip anything that isn't alphanumeric, underscore, dot, or hyphen
  return handle.replace(/[^a-zA-Z0-9._-]/g, "");
}

/**
 * Open an Instagram profile via deep-link (app → web fallback).
 */
export function openInstagramProfile(handle: string): void {
  const safe = sanitizeHandle(handle);
  if (!safe) return;
  Linking.openURL(`instagram://user?username=${safe}`).catch(() => {
    Linking.openURL(`https://instagram.com/${safe}`).catch(() => {});
  });
}

/**
 * Open a Snapchat profile via deep-link (app → web fallback).
 */
export function openSnapchatProfile(handle: string): void {
  const safe = sanitizeHandle(handle);
  if (!safe) return;
  Linking.openURL(`snapchat://add/${safe}`).catch(() => {
    Linking.openURL(`https://snapchat.com/add/${safe}`).catch(() => {});
  });
}
