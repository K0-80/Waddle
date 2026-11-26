# Waddle

Waddle is a transparent, full-screen desktop overlay with two goose sprites. They wander along the bottom, can be dragged around the screen, and fall under gravity when released. The window stays above other windows and passes pointer input through empty areas.

## How it works

- `src-tauri/tauri.conf.json` configures the transparent, always-on-top window.
- `src-tauri/src/lib.rs` sizes and positions it to cover the primary monitor.
- `src/main.ts` runs the canvas loop and uses Tauri's cursor-position API to turn click-through off only while the pointer is over a goose.
- `src/goose.ts` manages idle, wandering, quack, surprise, attack, peck, and gravity.
- `src/goose-renderer.ts` draws the 128x128 sprites with crisp pixel-art scaling and alpha-aware hit testing.
- `src/quack-audio.ts` synthesizes quack, surprised, and attacked effects with the Web Audio API; no audio files are required.
- `src-tauri/capabilities/default.json` grants the window permission to switch pointer handling.

Selective click-through is supported on Windows, macOS, and Linux with X11. Linux Wayland is not currently supported.

## Development

Install the JavaScript dependencies with `npm install`, then run `npm run tauri dev`. Use `npm run build` to check the frontend.

The static goose sprites are in `src/assets/` (`idle.png`, `quack.png`, `peck.png`, and `supprise.png`). If you later add sound assets instead of using synthesized effects, place them under `public/audio/` and wire their paths into `src/quack-audio.ts`.
