import { useBleStore } from "@/stores/bleStore";
import { useWaveStore } from "@/stores/waveStore";
import { useMatchStore } from "@/stores/matchStore";
import type { NearbyPeer } from "@/types";

let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

const NAMES = [
  "Sarah, blonde hair, blue jacket",
  "Alex, red hoodie at the bar",
  "Coffee addict, front table",
  "Emma, waiting outside",
  "Mia, curly hair",
  "Looking for my friend lol",
  "Just vibing at the cafe",
  "Jake, tall guy by the door",
  "Here for the concert tonight",
  "Olivia, black dress",
  "New in town, exploring!",
  "Lost and confused haha",
  "Marco, sitting by the window",
  "Chill vibes only",
  "Lily, green coat near entrance",
  "Waiting for the bus",
  "Dan, brown hat, outside",
  "Looking for coffee recs",
  "Priya, with my golden retriever",
  "Anyone wanna grab food?",
  "Tom, grey hoodie",
  "Studying at the library",
  "Soph, near the fountain",
  "On a walk through downtown",
  "Leo, headphones on",
  "At the park with friends",
  "First time trying Wave!",
  "Noor, blue scarf",
  "Rainy day vibes",
  "Chris, white sneakers",
  "Exploring the city solo",
  "Ava, reading by the window",
  "Working remotely from this cafe",
  "Ben, sitting outside",
  "Just moved here last week",
  "Zara, front row at the show",
  "Weekend mode activated",
  "Kai, skateboard guy",
  "Looking for study buddies",
  "Maya, pink jacket",
  "By the window seat, come say hi",
  "Ethan, glasses and a latte",
  "Walking around the old town",
  "Riya, red scarf near the stage",
  "Sam, just got here",
  "Luna, dancing in the back",
  "Liam, at the bar ordering",
  "Aria, corner booth",
  "Noah, camping out with a book",
  "Ella, waiting for my friend",
];

// Map some peer indices to fake match user IDs so "Still Nearby" badges
// appear in dev when both seedFakePeers and seedFakeMatches are active.
const PEER_USER_IDS: Record<number, string> = {
  0: "fake-user-001",   // HERE zone — matches sarah.wave
  3: "fake-user-004",   // HERE zone — matches emma.w
  18: "fake-user-002",  // CLOSE zone — matches alex.smith
  25: "fake-user-005",  // CLOSE zone — matches jake_adventures
  45: "fake-user-007",  // NEARBY zone — matches marco.polo
};

function generatePeers(): NearbyPeer[] {
  const now = Date.now();
  const genders: ("male" | "female" | null)[] = ["female", "male", "female", "male", "female", "male", null, "female", "male", "female", "male", null];
  const ages: (number | null)[] = [22, 25, 19, 28, 21, 33, null, 20, 27, 24, 31, 18, 23, 26, 35, 29, null, 22, 40, 19];
  const peers: NearbyPeer[] = [];

  for (let i = 0; i < NAMES.length; i++) {
    const idx = i + 1;
    const token = `a1b2c3d4e5f6${String(idx).padStart(4, "0")}`;

    // Distribute across zones: ~15 HERE, ~25 CLOSE, ~30 NEARBY
    let rssi: number;
    if (i < 15) {
      rssi = -35 - (i % 20); // HERE: -35 to -54
    } else if (i < 40) {
      rssi = -56 - (i % 19); // CLOSE: -56 to -74
    } else {
      rssi = -76 - (i % 14); // NEARBY: -76 to -89
    }

    peers.push({
      deviceBleId: `fake-${String(idx).padStart(3, "0")}`,
      ephemeralToken: token,
      rssi,
      lastSeen: now,
      discoveredAt: i < 5 ? now : now - (i * 30_000),
      gender: genders[i % genders.length],
      age: ages[i % ages.length],
      note: NAMES[i],
      userId: PEER_USER_IDS[i] ?? `fake-user-${String(idx).padStart(3, "0")}`,
      genderPreference: "both",
      agePreferenceMin: 18,
      agePreferenceMax: 80,
    });
  }

  return peers;
}

/**
 * DEV ONLY: Seed fake peers into bleStore for UI testing.
 * Call from radar or a debug button. Remove before release.
 */
export function seedFakePeers(): void {
  const store = useBleStore.getState();
  const waveStore = useWaveStore.getState();

  const fakePeers = generatePeers();

  // Insert all fake peers
  for (const peer of fakePeers) {
    store.upsertPeer(peer);
  }

  // Keep peers alive by refreshing lastSeen every 10s (prevents pruning)
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = setInterval(() => {
    const currentPeers = useBleStore.getState().nearbyPeers;
    const refreshed = Date.now();
    for (const peer of fakePeers) {
      if (currentPeers.has(peer.ephemeralToken)) {
        store.upsertPeer({ ...peer, lastSeen: refreshed });
      }
    }
  }, 10_000);

  // Simulate some interactions across different zones:
  waveStore.addIncomingWaveToken(fakePeers[0].ephemeralToken);  // HERE zone
  waveStore.addIncomingWaveToken(fakePeers[3].ephemeralToken);  // HERE zone
  waveStore.addIncomingWaveToken(fakePeers[6].ephemeralToken);  // HERE zone
  waveStore.addIncomingWaveToken(fakePeers[18].ephemeralToken); // CLOSE zone
  waveStore.addIncomingWaveToken(fakePeers[25].ephemeralToken); // CLOSE zone
  waveStore.addPendingWave(fakePeers[4].ephemeralToken);
}

/**
 * DEV ONLY: Seed fake matches into waveStore for history screen testing.
 * Creates a variety of matches: Instagram-only, Snapchat-only, both, and no socials.
 */
export function seedFakeMatches(): void {
  const store = useMatchStore.getState();
  const now = Date.now();

  const fakeMatches = [
    { matchId: "fake-match-001", matchedUserId: "fake-user-001", instagramHandle: "sarah.nearby", snapchatHandle: "sarah_snap", createdAt: new Date(now - 1 * 60_000).toISOString(), seen: true },
    { matchId: "fake-match-002", matchedUserId: "fake-user-002", instagramHandle: "alex.smith", snapchatHandle: "alex_sc", createdAt: new Date(now - 30 * 60_000).toISOString(), seen: true },
    { matchId: "fake-match-003", matchedUserId: "fake-user-003", instagramHandle: "mia.vibes", snapchatHandle: "mia_vibes", createdAt: new Date(now - 2 * 3600_000).toISOString(), seen: true },
    { matchId: "fake-match-004", matchedUserId: "fake-user-004", instagramHandle: "emma.w", snapchatHandle: "emma_snap22", createdAt: new Date(now - 5 * 3600_000).toISOString(), seen: false },
    { matchId: "fake-match-005", matchedUserId: "fake-user-005", instagramHandle: "jake_adventures", snapchatHandle: "jake_sc", createdAt: new Date(now - 24 * 3600_000).toISOString(), seen: true },
    { matchId: "fake-match-006", matchedUserId: "fake-user-006", instagramHandle: "olivia.nearby", snapchatHandle: "olivia.sc", createdAt: new Date(now - 25 * 3600_000).toISOString(), seen: true },
    { matchId: "fake-match-007", matchedUserId: "fake-user-007", instagramHandle: "marco.polo", snapchatHandle: "marco_s", createdAt: new Date(now - 48 * 3600_000).toISOString(), seen: true },
    { matchId: "fake-match-008", matchedUserId: "fake-user-008", instagramHandle: "lily.green", snapchatHandle: "lily_g", createdAt: new Date(now - 72 * 3600_000).toISOString(), seen: true },
    { matchId: "fake-match-009", matchedUserId: "fake-user-009", instagramHandle: "dan.the.man", snapchatHandle: "dan_snap", createdAt: new Date(now - 96 * 3600_000).toISOString(), seen: true },
    { matchId: "fake-match-010", matchedUserId: "fake-user-010", instagramHandle: "noor.explores", snapchatHandle: "noor_sc", createdAt: new Date(now - 120 * 3600_000).toISOString(), seen: true },
  ];

  for (const match of fakeMatches) {
    store.addMatch(match);
  }
}

/**
 * DEV ONLY: Trigger the match celebration screen with a fake match.
 * Creates an unseen match which MainLayout detects and navigates to /(main)/match.
 */
export function triggerFakeMatch(): void {
  const store = useMatchStore.getState();
  const id = `fake-match-live-${Date.now()}`;

  store.addMatch({
    matchId: id,
    matchedUserId: "fake-user-live",
    instagramHandle: "sarah.nearby",
    snapchatHandle: "sarah_snap",
    createdAt: new Date().toISOString(),
    seen: false,
  });
}

/**
 * DEV ONLY: Get fake blocked users for settings UI testing.
 */
export function getFakeBlockedUsers() {
  const now = Date.now();
  const names = [
    "@sarah.wave", "mia_vibes", null, "@jake_adventures", "@emma.lol",
    "alex_nearby", null, "@sofia.world", "noah_runs", "@olivia.cfg",
    "liam_beats", null, "@ava.design", "lucas_grind", "@chloe.fit",
    "ethan_travels", "@zoe.codes", null, "mason_plays", "@lily.snap",
    "james_chill", null, "@ella.art", "ben_skates", "@mila.nyc",
    "leo_waves", "@aria.uk", "henry_lifts", null, "@grace.vibes",
    "jack_dev", "@harper.co", null, "daniel_bmx", "@layla.music",
    "owen_chef", "@riley.sun", "seb_photo", null, "@nora.yoga",
    "will_climb", "@isla.reads", "cam_surfs", "@maya.ink", null,
    "ryan_drums", "@luna.sky", "max_hikes", "@stella.flow", null,
    "adam_dj", "@violet.draws", "kai_boards", "@hazel.bakes", null,
    "theo_games", "@ivy.runs", "finn_codes", "@ruby.sings", "@jade.pixels",
  ];

  return names.map((name, i) => ({
    blockedId: `fake-blocked-${String(i + 1).padStart(3, "0")}`,
    displayName: name,
    createdAt: new Date(now - (i + 1) * 3600_000 * 4).toISOString(),
  }));
}

/**
 * DEV ONLY: Clear all fake matches.
 */
export function clearFakeMatches(): void {
  useMatchStore.getState().clearMatches();
}

/**
 * DEV ONLY: Clear all fake peers.
 */
export function clearFakePeers(): void {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
  useBleStore.getState().clearPeers();
  useWaveStore.getState().clearAllPendingWaves();
  useWaveStore.getState().resetIncomingWaveTokens();
  useMatchStore.getState().clearMatchedTokens();
}
