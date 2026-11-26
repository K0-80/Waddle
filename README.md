# Waddle

A tiny flock of geese that lives on your screen while you pretend to study. Sign in
to see your goose alongside other online Waddle users.

## How it works

- `src-tauri/tauri.conf.json` configures the transparent overlay window; always-on-top is enabled only while signed in.
- `src-tauri/src/lib.rs` sizes and positions it to cover the primary monitor.
- `src/main.ts` runs the canvas loop, handles local goose interactions, and toggles always-on-top and click-through behavior by auth state.
- `src/goose.ts` manages idle, wandering, quack, surprise, attack, peck, and gravity.
- `src/goose-renderer.ts` animates 64x64-frame sprite sheets at 128x128 with crisp pixel-art scaling, Monocraft name tags, and alpha-aware hit testing. It accepts both horizontal and vertical sheets.
- `src/auth-ui.ts` handles email/password signup, sign-in, session restoration, and sign-out.
- `src/multiplayer.ts` uses Trystero rooms for peer-to-peer sync. Users create or join by room name; each room supports up to six players. Goose position snapshots are sent every 50 ms so late joiners see current positions and remote movement can be smoothed. Supabase credentials are never sent to Trystero.
- `src/quack-audio.ts` plays the honk and attack sounds as overlapping one-shots and loops the running sound during attacks.
- `src/settings.ts` configures sprite animation FPS and goose walking/running speeds.
- `src-tauri/capabilities/default.json` grants the window permission to switch pointer handling.
- `src/assets/fonts/Monocraft.ttf` contains the Monocraft font, distributed under the included SIL Open Font License.
- The Monocraft font is Copyright (c) 2022 Idrees Hassan and is distributed under the [SIL Open Font License 1.1](./src/assets/fonts/OFL.txt); it is bundled from [IdreesInc/Monocraft](https://github.com/IdreesInc/Monocraft).

Selective click-through is supported on Windows, macOS, and Linux with X11. Linux Wayland is not currently supported.

## Development

Install the JavaScript dependencies with `npm install`, then create `.env.local` in the repository root with the Supabase project URL and publishable key:

```dotenv
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

These are public client values. For older Supabase projects, `VITE_SUPABASE_ANON_KEY` is also accepted. Never put a Supabase secret/service-role key in the app or its environment file.

Run `npm run tauri dev` to start the desktop app. Use `npm run build` to check the frontend.

## Supabase setup

1. In the Supabase dashboard, enable Email under **Authentication → Sign In / Providers** and turn **Confirm email** off. Email/password signup will then create a session immediately; Waddle does not ask users to confirm an email. This is a project-level Auth setting and cannot be changed by the desktop client.
2. Users register with email, a unique 3–20 character username (letters, numbers, and underscores), and a password; they sign in with email and password. With email confirmation disabled, accounts are not verified by email.
3. Run [`supabase/migrations/20261126000000_create_profiles_and_realtime_policies.sql`](./supabase/migrations/20261126000000_create_profiles_and_realtime_policies.sql), followed by [`supabase/migrations/20261126153000_remove_legacy_waddle_realtime_policies.sql`](./supabase/migrations/20261126153000_remove_legacy_waddle_realtime_policies.sql), in the Supabase SQL Editor. The first migration creates profiles with case-insensitive unique usernames and an empty JSON settings object for future account preferences. The second removes the old Waddle global-lobby Realtime policies. Row-level security lets users read their own profile and update only settings; a database trigger creates each profile during signup.
4. Supabase Realtime does not need to be enabled or configured for Waddle multiplayer. Supabase remains responsible for authentication and profile lookup.
5. Copy the project URL and publishable key into `.env.local` as shown above, then restart Vite/Tauri.

Create a room by entering a room name and selecting **Create room**; friends join by entering the same name and selecting **Join room**. Room names are normalized to lowercase and act as invite codes—anyone who knows a code can join, so use a non-obvious name for private groups. Trystero uses public Nostr relays for discovery/signaling, then sends goose action state, normalized position snapshots every 50 ms, and attack messages directly between peers over encrypted WebRTC. Normalized positions map to each peer's canvas size so geese align with each player's ground. Remote geese follow the received positions without running independent gravity or movement simulation, avoiding floor jitter and easing movement updates rather than snapping. No Supabase Realtime presence is sent. The six-player limit keeps each peer-to-peer room small. Click your goose to honk, click another player's goose to attack it, and drag only your own goose. A Trystero room can be joined even when empty; Create and Join both enter the room named by the code.

Supabase Free-tier Auth/Database limits and project inactivity pausing still apply; moving room traffic to Trystero avoids Supabase Realtime usage, not all Supabase limits.

The idle, walk, and run sheets are in `src/assets/sprites/`. Quack, peck, and surprise sprites are in `src/assets/`; the honk, attack, and running sounds are in `src/assets/sounds/`.
