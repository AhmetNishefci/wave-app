# Wave

**Real-world proximity matching through Bluetooth.**

Wave is a mobile app that lets nearby strangers connect. When two people wave at each other, they match and exchange socials (Instagram and/or Snapchat) — no profiles, no swiping, just real-world presence.

Built with React Native 0.81, Expo 54, and Supabase.

---

## How It Works

1. **Discover** — Your phone continuously broadcasts and scans for nearby Wave users via BLE (Bluetooth Low Energy). Each user appears as an anonymous avatar on a radar screen.
2. **Wave** — Tap a nearby person to send a wave. They don't know who waved — only that someone nearby did.
3. **Match** — If both people wave at each other, it's a match. Both users see each other's social handles (Instagram and/or Snapchat).
4. **Connect** — Open their profile directly from the app and start a conversation.

Privacy is core to the design: users are identified only by ephemeral tokens that rotate every 15 minutes. No names, photos, or personal information are ever broadcast over Bluetooth.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  React Native App (Expo 54, RN 0.81)                 │
│                                                       │
│  Expo Router 6           Zustand 5 (5 stores)        │
│  NativeWind / Tailwind   Reanimated 4                │
│                                                       │
│  ┌────────────┐  ┌────────────┐  ┌───────────────┐  │
│  │ BLE        │  │ Wave       │  │ Auth           │  │
│  │ Scanner    │  │ Service    │  │ (Google/Apple/ │  │
│  │ + Periph   │  │ + Realtime │  │  Phone OTP)    │  │
│  └─────┬──────┘  └─────┬──────┘  └───────┬───────┘  │
└────────┼───────────────┼─────────────────┼───────────┘
         │               │                 │
         ▼               ▼                 ▼
┌──────────────────────────────────────────────────────┐
│  Supabase                                             │
│                                                       │
│  Auth (Apple/Google/Phone)  Realtime (broadcast)      │
│  PostgreSQL + PostGIS       11 Edge Functions (Deno)  │
│  RLS + SECURITY DEFINER    pg_cron + pg_net           │
│  Push via Expo API          Email via Resend          │
└──────────────────────────────────────────────────────┘
```

### Client Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.81 + Expo 54 (New Architecture) |
| Routing | Expo Router 6 (file-based) |
| State | Zustand 5 (`tokenStore`, `waveStore`, `matchStore`, `bleStore`, `authStore`) |
| Styling | NativeWind 4 / Tailwind CSS 3.4 |
| Animations | React Native Reanimated 4 |
| BLE Central | `react-native-ble-plx` 3.5 |
| BLE Peripheral | Custom Expo module (`expo-ble-peripheral`, Swift/CoreBluetooth) |
| Auth | `expo-apple-authentication` + `@react-native-google-signin/google-signin` + Phone OTP → Supabase Auth |
| Networking | `@react-native-community/netinfo` for offline detection |
| i18n | `react-i18next` with 7 languages (EN, DE, FR, ES, IT, PT, TR) |

### Backend Stack

| Layer | Technology |
|-------|-----------|
| Database | Supabase PostgreSQL with PostGIS |
| Auth | Supabase Auth (Apple + Google ID token exchange, Phone OTP via Twilio) |
| API | 11 Supabase Edge Functions (Deno/TypeScript) with Zod validation |
| Realtime | Supabase Realtime broadcast channels |
| Push Notifications | Expo Push API (via Edge Functions) |
| Support Email | Resend API |
| Scheduled Jobs | `pg_cron` (cleanup, daily engagement) |
| Access Control | Row Level Security (RLS) + `SECURITY DEFINER` functions |
| CORS | Origin-aware shared module (restricts browser access) |

---

## Project Structure

```
Wave-app/
├── app/                          # Expo Router screens
│   ├── _layout.tsx               # Root layout (auth gate)
│   ├── index.tsx                 # Splash / entry redirect
│   ├── login.tsx                 # Sign in (Apple, Google, Phone)
│   ├── phone-login.tsx           # Phone number + OTP verification
│   ├── birthday.tsx              # Age verification (DOB input)
│   ├── age-blocked.tsx           # Under-age rejection screen
│   ├── gender.tsx                # Gender selection
│   ├── onboarding.tsx            # Social handles (Instagram/Snapchat)
│   ├── note.tsx                  # Personal note editor
│   ├── nearby-alerts.tsx         # Push notification opt-in
│   └── (main)/                   # Authenticated screens
│       ├── _layout.tsx           # Tab navigator
│       ├── radar.tsx             # Live peer radar (main screen)
│       ├── history.tsx           # Match history (paginated)
│       ├── match.tsx             # Match celebration + confetti
│       └── settings.tsx          # Profile, support & app settings
├── src/
│   ├── components/               # Reusable UI components
│   ├── hooks/
│   │   ├── useBleLifecycle.ts    # BLE lifecycle + foreground reconciliation
│   │   ├── useEphemeralRotation.ts # Token rotation timer
│   │   ├── useMatchListener.ts   # Realtime subscription hook
│   │   ├── useNearbyMatchIds.ts  # Nearby match detection
│   │   ├── useNetworkStatus.ts   # Connectivity monitoring
│   │   ├── useNoteResolver.ts    # Batch note resolution (polling)
│   │   └── useNotifications.ts   # Push notification registration
│   ├── services/
│   │   ├── auth.ts               # Google/Apple/Phone auth + sign-out
│   │   ├── supabase.ts           # Supabase client init
│   │   ├── profile.ts            # User profile CRUD + timezone sync
│   │   ├── notifications.ts      # Push token registration
│   │   ├── location.ts           # Location tracking
│   │   ├── ble/
│   │   │   ├── bleManager.ts     # BLE lifecycle manager (singleton)
│   │   │   ├── scanner.ts        # BLE central (scan + GATT reads)
│   │   │   ├── advertiser.ts     # BLE peripheral (advertising)
│   │   │   ├── permissions.ts    # Bluetooth permission handling
│   │   │   ├── parsePayload.ts   # Shared BLE payload parser
│   │   │   └── constants.ts      # BLE UUIDs, timing constants
│   │   └── wave/
│   │       ├── waves.ts          # Send/undo wave, block, remove match + offline queue
│   │       ├── matches.ts        # Fetch matches (cursor-based pagination)
│   │       ├── realtime.ts       # Supabase Realtime subscription + reconnection
│   │       ├── ephemeralId.ts    # Ephemeral token fetch (pure data, no store mutations)
│   │       └── session.ts        # Session refresh helper
│   ├── stores/
│   │   ├── tokenStore.ts         # Ephemeral token state (currentToken, expiry, rotating)
│   │   ├── waveStore.ts          # Wave state (pending waves, incoming wave tokens)
│   │   ├── matchStore.ts         # Match state (matchesById Map, unseenCount, handles)
│   │   ├── bleStore.ts           # BLE state (nearby peers, scanning status)
│   │   └── authStore.ts          # Auth state (user, session, profile preferences)
│   ├── types/
│   │   └── index.ts              # Shared types (Gender, NearbyPeer, Match, etc.)
│   ├── constants/
│   │   ├── colors.ts             # Dark theme color palette
│   │   ├── icebreakers.ts        # Match conversation starters
│   │   ├── zones.ts              # Distance zone config
│   │   └── countries.ts          # Country codes for phone auth
│   ├── utils/
│   │   ├── logger.ts             # Structured logger (ble, wave, auth channels)
│   │   ├── haptics.ts            # Haptic feedback
│   │   ├── sound.ts              # Match chime audio
│   │   ├── deepLink.ts           # Sanitized social platform deep-links
│   │   ├── age.ts                # Age calculation from DOB
│   │   ├── routeFromProfile.ts   # Profile-based routing (with 15s timeout)
│   │   ├── seedPeers.ts          # Dev-only simulated peers
│   │   └── platform.ts           # Platform utilities
│   └── i18n/
│       ├── index.ts              # i18next configuration
│       └── locales/              # 7 language files (EN, DE, FR, ES, IT, PT, TR)
├── modules/
│   └── expo-ble-peripheral/      # Custom Expo module (Swift/CoreBluetooth)
├── supabase/
│   ├── functions/                # 11 Edge Functions
│   │   ├── _shared/
│   │   │   ├── cors.ts           # Origin-aware CORS headers
│   │   │   └── validation.ts     # Zod schemas + parseBody helper
│   │   ├── assign-ephemeral-id/  # Ephemeral token assignment
│   │   ├── send-wave/            # Wave + match creation (advisory locks)
│   │   ├── remove-match/         # Match deletion + broadcast
│   │   ├── block-user/           # Block + report + match removal
│   │   ├── update-location/      # PostGIS location update + proximity alerts
│   │   ├── send-support-email/   # Support ticket email via Resend
│   │   ├── cleanup/              # Expired data cleanup (cron)
│   │   ├── daily-engagement/     # Re-engagement push notifications (cron)
│   │   ├── delete-account/       # GDPR account deletion
│   │   ├── auth-instagram/       # Instagram OAuth (backend ready, UI pending)
│   │   └── auth-callback/        # OAuth callback handler
│   └── migrations/               # 16 SQL migrations
└── assets/                       # App icons, splash screen, sounds
```

---

## BLE Protocol

Wave uses a custom BLE protocol for anonymous peer discovery.

### Advertising Format

```
Service UUID: E5C00001-B5A3-F393-E0A9-E50E24DCCA9E
Local Name:   "E:{gender_char}{age_2digits}{16-hex-token}"
              e.g. "E:M23abc123def456a7b8"
```

- **Gender char**: `M` (male) or `F` (female)
- **Age**: 2-digit age (18-99)
- **Token**: 16-character lowercase hex string, rotated every 15 minutes
- Backward-compatible formats: `E:{gender}{token}` (17 chars) and `E:{token}` (16 chars, legacy)

### GATT Fallback (iOS Background)

iOS strips the local name from BLE advertisements when the advertising app is backgrounded. Wave reads the token via GATT characteristic:

```
Characteristic UUID: E5C00002-B5A3-F393-E0A9-E50E24DCCA9E
Value: "{gender_char}{age_2digits}{16-hex-token}" (UTF-8)
```

Concurrent GATT connections capped at 4, with queue of max 20.

### Timing

| Parameter | Value |
|-----------|-------|
| Token rotation | 15 minutes |
| Early refresh buffer | 3 minutes (with ±30s jitter) |
| Scan duration | 10 seconds per cycle |
| Scan pause | 2 seconds between cycles |
| Peer stale timeout | 30 seconds |
| GATT connect timeout | 5 seconds |
| GATT read cooldown | 30 seconds |

---

## Key Features

### Store Architecture

| Store | Purpose | Persisted |
|-------|---------|-----------|
| `tokenStore` | Ephemeral token, expiry, rotation state | No |
| `waveStore` | Pending waves, incoming wave tokens (capped at 100) | No |
| `matchStore` | Matches (Map for O(1) lookups), unseen count, matched tokens/handles | Yes (AsyncStorage) |
| `bleStore` | Nearby peers (capped at 200), scanning/advertising state | No |
| `authStore` | Session, user profile, preferences | No (Supabase JWT) |

### Wave + Match Flow
- Tap a peer to send a wave → `send-wave` Edge Function
- Server uses PostgreSQL advisory locks for atomic match creation
- On match: Realtime broadcast + push notification to both users
- Match celebration screen with confetti, haptics, and chime
- Contact handles fetched via authenticated RPC (never broadcast)
- Recent matches (< 5 min) from server trigger celebration on app reopen

### Offline Resilience
- **Wave queue**: Staggered retry (3s between) when connectivity returns
- **GATT queue**: 4 concurrent, 20 queued, processed as slots open
- **Realtime reconnection**: Exponential backoff (3s → 60s), network-aware
- **Foreground reconciliation**: Token expiry check, stale wave cleanup, server match fetch

### Support System
- In-app structured ticket form (category + details, stored in DB, rate limited 5/hour)
- Email notification to support inbox via Resend (with device diagnostics, reply-to)
- Confirmation screen after submission
- Direct email option (`mailto:`) as alternative channel

### Security
- Zod input validation on 5 edge functions
- Origin-aware CORS (denies unknown browser origins)
- Sanitized deep-link URLs
- OTP brute-force protection (5 attempts, 30s lockout)
- Push token cleanup on sign-out
- HTML escaping in support emails
- Block check inside advisory lock (prevents race condition)
- Per-trigger proximity notification cooldown

---

## Developer Setup

### Prerequisites

- Node.js 18+
- Xcode 16+ (for iOS)
- Ruby + CocoaPods (for iOS native modules)
- A Supabase project
- Google Cloud project with OAuth 2.0 credentials
- EAS CLI (`npm install -g eas-cli`)
- Resend account (for support emails)

### Installation

```bash
git clone <repo-url>
cd Wave/Wave-app
npm install
cp .env.example .env    # Fill in your values
cd ios && pod install && cd ..
```

### Environment Variables

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-google-web-client-id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=your-google-ios-client-id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME=com.googleusercontent.apps.your-google-ios-client-id
```

### Supabase Secrets

```bash
supabase secrets set RESEND_API_KEY=your-resend-api-key
```

### Running

```bash
npx expo start              # Start Metro bundler
npx expo run:ios             # Run on iOS simulator
npx expo run:ios --device    # Run on physical device (required for BLE)
```

> BLE does not work in the iOS Simulator. You need a physical device to test peer discovery and advertising.

### Database & Edge Functions

```bash
supabase db push                            # Apply all migrations
supabase functions deploy --no-verify-jwt   # Deploy all edge functions
```

---

## Edge Functions

| Function | Purpose | Auth | Validation |
|----------|---------|------|------------|
| `assign-ephemeral-id` | Assigns new ephemeral token | JWT | — |
| `send-wave` | Wave + match creation (advisory locks) | JWT | Zod |
| `remove-match` | Match deletion + broadcast | JWT | Zod |
| `block-user` | Block + report + match removal | JWT | Zod |
| `update-location` | PostGIS location + proximity alerts | JWT | Zod |
| `send-support-email` | Support ticket email via Resend | JWT | Manual |
| `delete-account` | GDPR account deletion (CASCADE) | JWT | — |
| `cleanup` | Expired data cleanup | Service key | — |
| `daily-engagement` | Re-engagement push notifications | Service key | — |
| `auth-instagram` | Instagram OAuth (backend ready) | — | Zod |
| `auth-callback` | OAuth redirect handler | — | — |

---

## Database Schema

Core tables (16 migrations in `supabase/migrations/`):

- **`profiles`** — User profiles (gender, DOB, handles, preferences, PostGIS location)
- **`ephemeral_ids`** — Active ephemeral tokens (rotated every 15 min)
- **`waves`** — Pending wave records (expires after 15 min)
- **`matches`** — Confirmed matches (unique user pairs via LEAST/GREATEST)
- **`blocks`** — Bidirectional user blocks
- **`reports`** — User reports (admin-only via service_role)
- **`support_tickets`** — In-app support requests (rate limited 5/hour)
- **`push_tokens`** — Expo push notification tokens
- **`proximity_notifications`** — Per-trigger cooldown tracking
- **`engagement_notifications`** — Daily push cooldown tracking
- **`push_receipts`** — Deferred Expo receipt checking

All tables protected by Row Level Security. Sensitive operations use `SECURITY DEFINER` functions with `auth.uid()` validation.

---

## Design System

Dark theme via NativeWind/Tailwind:

| Token | Hex | Usage |
|-------|-----|-------|
| `wave-bg` | `#0a0a0a` | App background |
| `wave-surface` | `#1a1a2e` | Cards, modals |
| `wave-primary` | `#6c63ff` | Primary actions |
| `wave-accent` | `#00d4aa` | Secondary accent |
| `wave-text` | `#e0e0e0` | Primary text |
| `wave-muted` | `#8585a0` | Secondary text (WCAG AA) |
| `wave-danger` | `#ff4757` | Destructive actions |
| `wave-wave` | `#4ecdc4` | Wave action |
| `wave-match` | `#ec4899` | Match celebrations |

---

## TODO

### Before First Build
- [x] ~~Integrate Sentry for crash reporting~~ ✅ Done
- [x] ~~Deploy website to Vercel~~ ✅ Live at wave-website-dun.vercel.app
- [x] ~~APS entitlement~~ ✅ Dynamic — auto-switches dev/production based on EAS build profile
- [ ] Run `npx sentry-cli login` (one-time — enables source map upload for readable crash traces)

### Before App Store Submission
- [ ] Buy `wave-app.com` domain → connect to Vercel → update Privacy Policy & Terms URLs
- [ ] Verify `wave-app.com` in Resend → update sender from `onboarding@resend.dev` to `support@wave-app.com`
- [ ] Update `SUPPORT_EMAIL` in `send-support-email` edge function from dev email to `support@wave-app.com`
- [ ] Replace download button placeholders with real App Store / Play Store URLs
- [ ] Prepare App Store assets: screenshots, description, keywords, promotional text
- [ ] Fill in App Store privacy nutrition labels (data collection declarations)
- [ ] Add basic analytics (app opens, waves sent, matches created, DAU)

### Backlog
- [ ] **Android BLE Peripheral** — Implement advertising on Android (scanning already works)
- [ ] **Instagram OAuth** — Wire backend (ready) into login UI
- [ ] **Monetization** — Premium features, subscription model
- [ ] **Test Suite** — Unit tests for stores, services, BLE parsing; integration tests for wave/match
- [ ] **Account Linking** — Let users add multiple auth methods to one account
- [ ] **Admin Dashboard** — Moderation interface for reports and tickets
- [ ] **Supabase Pro** — Scale beyond free tier limits (200 Realtime connections, 2 concurrent Edge Functions)

---

## Current Limitations

- **iOS only** for BLE peripheral advertising (scanner works on both platforms)
- **Supabase Free tier** limits: 200 concurrent Realtime connections, 2 concurrent Edge Functions
- **No automated tests** — All testing is manual
- **Crash reporting** — Sentry integrated (errors + breadcrumbs + user/device context), source maps upload pending first production build
- **BLE range** — Effective ~30 meters (hardware dependent), best under 10 meters
- **No account linking** — Apple, Google, and Phone sign-ins create separate accounts
- **Support emails** sent from `onboarding@resend.dev` until domain verification (may hit spam)

---

## License

Private — All rights reserved.
