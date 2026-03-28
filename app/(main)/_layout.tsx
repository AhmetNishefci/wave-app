import { useEffect, useRef } from "react";
import { View, Text } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import { waveBleManager } from "@/services/ble/bleManager";
import { useMatchStore } from "@/stores/matchStore";
import { useBleStore } from "@/stores/bleStore";
import { useTokenStore } from "@/stores/tokenStore";
import * as Notifications from "expo-notifications";
import { useBleLifecycle } from "@/hooks/useBleLifecycle";
import { useEphemeralRotation } from "@/hooks/useEphemeralRotation";
import { useMatchListener } from "@/hooks/useMatchListener";
import { useNotifications } from "@/hooks/useNotifications";
import { logger } from "@/utils/logger";
import { preloadSounds } from "@/utils/sound";
import { COLORS } from "@/constants/colors";

export default function MainLayout() {
  const { t } = useTranslation();
  const router = useRouter();
  const latestUnseenMatch = useMatchStore((s) => s.latestUnseenMatch);
  const adapterState = useBleStore((s) => s.adapterState);
  const isDiscoveryActive = useBleStore((s) => s.isDiscoveryActive);
  const hasToken = useTokenStore((s) => !!s.currentToken);
  const tokenExpiresAt = useTokenStore((s) => s.tokenExpiresAt);

  // Keep Sentry context updated with device state for crash diagnostics
  useEffect(() => {
    Sentry.setContext("ble", { adapterState, isDiscoveryActive });
  }, [adapterState, isDiscoveryActive]);

  useEffect(() => {
    Sentry.setContext("token", {
      hasToken,
      expiresIn: tokenExpiresAt ? Math.round((tokenExpiresAt - Date.now()) / 1000) : null,
    });
  }, [hasToken, tokenExpiresAt]);

  // Sync app icon badge with unseen match count (reads from store directly
  // to avoid re-rendering the entire Tabs layout on every count change).
  useEffect(() => {
    const unsub = useMatchStore.subscribe((state, prev) => {
      if (state.unseenCount !== prev.unseenCount) {
        try {
          Notifications.setBadgeCountAsync(state.unseenCount).catch(() => {});
        } catch {
          // expo-notifications may not be available
        }
      }
    });
    return unsub;
  }, []);

  // Initialize BLE manager on mount
  useEffect(() => {
    waveBleManager.initialize().catch((error) => {
      logger.error("Failed to initialize BLE manager", error);
    });

    preloadSounds();

    // Recover unseen matches from persisted storage (M3 fix).
    // If the app crashed or was killed before the user saw the match
    // celebration, re-trigger it on next launch.
    const matches = useMatchStore.getState().getMatchesArray();
    const unseenMatch = matches.find((m) => !m.seen);
    if (unseenMatch && !useMatchStore.getState().latestUnseenMatch) {
      useMatchStore.setState({ latestUnseenMatch: unseenMatch });
    }

    return () => {
      waveBleManager.stop();
    };
  }, []);

  // Manage BLE on app foreground/background
  useBleLifecycle();

  // Fetch and rotate ephemeral tokens
  useEphemeralRotation();

  // Listen for match events via Supabase Realtime
  useMatchListener();

  // Push notification registration & tap handling
  useNotifications();

  // Navigate to match screen when a new match arrives (with guard against double push)
  const navigatedMatchRef = useRef<string | null>(null);
  useEffect(() => {
    if (latestUnseenMatch && latestUnseenMatch.matchId !== navigatedMatchRef.current) {
      navigatedMatchRef.current = latestUnseenMatch.matchId;
      router.push("/(main)/match");
    }
  }, [latestUnseenMatch, router]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.bg,
          borderTopColor: COLORS.surface,
          borderTopWidth: 1,
          height: 85,
          paddingBottom: 30,
          paddingTop: 8,
        },
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="radar"
        options={{
          title: t("tabs.radar"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="radio-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t("tabs.matches"),
          tabBarIcon: ({ color, size }) => (
            <MatchTabIcon color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tabs.settings"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="match"
        options={{
          href: null, // Hide from tab bar — opened programmatically
        }}
      />
    </Tabs>
  );
}

/**
 * Self-contained tab icon for the Matches tab. Reads unseenCount from the
 * store internally so the parent Tabs component doesn't re-render (and
 * reset the active tab) when the count changes.
 */
function MatchTabIcon({ color, size }: { color: string; size: number }) {
  const unseenCount = useMatchStore((s) => s.unseenCount);
  return (
    <View>
      <Ionicons name="heart-outline" size={size} color={color} />
      {unseenCount > 0 && (
        <View
          style={{
            position: "absolute",
            top: -4,
            right: -10,
            backgroundColor: COLORS.match,
            borderRadius: 9,
            minWidth: 18,
            height: 18,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 4,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>
            {unseenCount}
          </Text>
        </View>
      )}
    </View>
  );
}
