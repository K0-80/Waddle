# Waddle

A tiny, unhinged a flock of geese that lives on your screen while you pretend to study.
Attack your friends in real time while they try to focus.

## How it works

- `src-tauri/tauri.conf.json` configures the transparent, always-on-top window.
- `src-tauri/src/lib.rs` sizes and positions it to cover the primary monitor.
- `src/main.ts` runs the canvas loop, assigns the `Triple T` and `test subject` name tags, and uses Tauri's cursor-position API to turn click-through off only while the pointer is over a goose.
- `src/goose.ts` manages idle, wandering, quack, surprise, attack, peck, and gravity.
- `src/goose-renderer.ts` animates 64x64-frame sprite sheets at 128x128 with crisp pixel-art scaling, Minecraft-style name tags, and alpha-aware hit testing. It accepts both horizontal and vertical sheets.
- `src/quack-audio.ts` plays the honk and attack sounds as overlapping one-shots and loops the running sound during attacks.
- `src/settings.ts` configures sprite animation FPS and goose walking/running speeds.
- `src-tauri/capabilities/default.json` grants the window permission to switch pointer handling.

Selective click-through is supported on Windows, macOS, and Linux with X11. Linux Wayland is not currently supported.

## Development

Install the JavaScript dependencies with `npm install`, then run `npm run tauri dev`. Use `npm run build` to check the frontend.

The idle, walk, and run sheets are in `src/assets/sprites/`. Quack, peck, and surprise sprites are in `src/assets/`; the honk, attack, and running sounds are in `src/assets/sounds/`.
