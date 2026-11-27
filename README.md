<h1>
<img width="64" height="64" alt="image" src="https://github.com/user-attachments/assets/53e098b5-512e-4e4e-b956-6b3dc6f16d9b" />
   &nbsp;Waddle
</h1>

A tiny goose that lives on your screen while you pretend to study. Sign in to see your goose alongside other online Waddle users in REAL TIME!
<img width="441" height="586" alt="{A5E9B5BD-3A11-4AFF-8994-7DA51D2862B4}" src="https://github.com/user-attachments/assets/e2eec25a-7b4a-47db-8eb0-23b7ec84df46" />


## How it works

- `src-tauri/tauri.conf.json` configures the transparent overlay window; always-on-top is enabled only while signed in.
- `src-tauri/src/lib.rs` sizes and positions it to cover the primary monitor.
- `src/main.ts` runs the canvas loop, handles goose interactions, and positions one signed-in profile/room menu above the goose that opened it.
- `src/goose.ts` manages idle, wandering, quack, surprise, attack, peck, and gravity, including target-contact attack termination.
- `src/goose-renderer.ts` animates 64x64-frame sprite sheets at 128x128 with crisp pixel-art scaling, hover-only Monocraft name tags, and alpha-aware hit testing. It accepts both horizontal and vertical sheets.
- `src/auth-ui.ts` handles email/password signup, sign-in, session restoration, and sign-out.
- `src/multiplayer.ts` uses Trystero rooms for peer-to-peer sync. Users create or join by room name; each room supports up to six players. Goose position snapshots are sent every 50 ms so late joiners see current positions and remote movement can be smoothed. Supabase credentials are never sent to Trystero.
- `src/quack-audio.ts` plays synchronized room honks, attacks, impacts, and per-goose running loops.
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
3. Run [`supabase/migrations/20261126000000_create_profiles_and_realtime_policies.sql`](./supabase/migrations/20261126000000_create_profiles_and_realtime_policies.sql), followed by [`supabase/migrations/20261126153000_remove_legacy_waddle_realtime_policies.sql`](./supabase/migrations/20261126153000_remove_legacy_waddle_realtime_policies.sql), in the Supabase SQL Editor. The first migration creates profiles with case-insensitive unique usernames and a JSON settings object for account preferences such as About Me. The second removes the old Waddle global-lobby Realtime policies. Row-level security lets users read their own profile and update only settings; a database trigger creates each profile during signup.
4. Supabase Realtime does not need to be enabled or configured for Waddle multiplayer. Supabase remains responsible for authentication and profile lookup.
5. Copy the project URL and publishable key into `.env.local` as shown above, then restart Vite/Tauri.

After signing in, the account menu opens above your goose. Right-click your goose to open or close it; the menu follows the goose and stays inside the screen. While your personal menu is open, your goose stays in its idle animation while gravity and collisions continue; an incoming attack can still trigger its surprise animation. Viewing another player's menu does not affect your goose. The menu stays open after joining a room and reopens when leaving. Use the About Me field to save a short profile message to your Supabase settings. Right-click another player's goose to view their username and About Me; left-click still honks your goose or attacks another player's goose. Only one profile menu can be open at a time. Hover name tags are rendered locally. The connection dot is green when online, orange while connecting, and red when offline.

About Me saves automatically after you stop typing; a brief status appears beside its label. A divider separates it from the flock controls.

Select **Settings** to configure always-on-top, mute-when-unfocused, always-visible nametags, and volume. Nametags otherwise appear locally on hover; they stay hidden for the goose whose profile menu is open. Settings are stored in the user's Supabase profile settings. Use **Back** to return to the About Me and flock menu. **Exit** closes Waddle; **Sign out** is in Settings.

Enter a room name and select **Join Flock** to join or create that room. Trystero does not provide a room directory, so no room-existence check is performed; a new room is created if no one is already using that name. Room names are normalized to lowercase and act as invite codes—anyone who knows a code can join, so use a non-obvious name for private groups. Trystero uses public Nostr relays for discovery/signaling, then sends goose action state, normalized position snapshots every 50 ms, attack messages, and sound events directly between peers over encrypted WebRTC. Room members hear each other's honks, attacks, running loops, and splat impacts. Normalized positions map to each peer's canvas size so geese align with each player's ground. Remote geese follow the received positions without running independent gravity or movement simulation, avoiding floor jitter and easing movement updates rather than snapping. The room’s **Online for** time is measured from its first participant’s shared room-start timestamp. No Supabase Realtime presence is sent. The six-player limit keeps each peer-to-peer room small. Click your goose to honk, click another player's goose to attack it, and drag only your own goose.

Supabase Free-tier Auth/Database limits and project inactivity pausing still apply; moving room traffic to Trystero avoids Supabase Realtime usage, not all Supabase limits.

The idle, walk, and run sheets are in `src/assets/sprites/`. Quack, peck, and surprise sprites are in `src/assets/`; the honk, attack, running, and splat sounds are in `src/assets/sounds/`.

## Windows distribution

Run `npm run tauri build` on Windows. Share the generated NSIS `*-setup.exe` from `src-tauri/target/release/bundle/nsis/` for the simplest install flow; the MSI in `src-tauri/target/release/bundle/msi/` is an alternative. Distribute these installers rather than the unpackaged executable.

The Windows app icon is generated from `src/assets/icon.png` into `src-tauri/icons/`, including `icon.ico`. Unsigned downloads can trigger Microsoft SmartScreen warnings. Authenticode-sign each release with a trusted code-signing certificate and timestamp it; signing identifies the publisher but does not guarantee a new app immediately avoids SmartScreen warnings. Keep using the same publisher certificate across releases to build reputation. If Defender identifies a clean release as malware, submit that exact installer to Microsoft's [security intelligence file submission portal](https://www.microsoft.com/en-us/wdsi/filesubmission) for review. Never distribute your signing private key or certificate password with the app.
