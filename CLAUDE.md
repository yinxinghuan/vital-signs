# Vital Signs — Dev Guidelines

> 复制自 `/Users/yin/code/games/CLAUDE.md`，per-game 微调。

## Concept

Rhythm survival game in the AlterU After Dark series. Night-shift dream-ER framing: one random Aigram friend has crashed in your dream. Tap to maintain their heartbeat — match a drifting target BPM. Miss too many beats → flatline. Over-tap → V-fib. On death, AI types a deadpan death certificate; gen-image stamps a cold-tone morgue portrait. Fates post to a community wall.

## Phases

`splash → playing → dying → certificate → wall`

## Tech

- React 18 + TS strict + Less + Vite 5
- Aigram runtime via `@shared` (bridge / useChat / useGenImage / useGameEvent / useGameStats)
- Canvas ECG rendering (R-wave at each beat, scrolling R→L)
- Web Audio synth: lub-dub thump, soft metronome, flatline tone, V-fib noise

## Hard rules (project memory)

- `onPointerDown` only
- **Audio first-touch only** — never `resumeAudio()` on mount; only inside first pointerdown
- **No emoji in UI** — every glyph SVG/CSS
- **No outer `border-radius`** on root — Aigram already wraps
- **AlterU watermark** (not Aigram) — `/alteru.svg`, no `filter: invert`
- **Real usernames only** for characters based on users
- BEM `vs-` prefix on CSS + `@keyframes vs-*`
- **Hold/charge iOS selection** — `*` selector gets `-webkit-touch-callout:none; -webkit-user-select:none; user-select:none`
- **Game UX**: 1.5s grace period at game start — no decay penalty before then

## Visual

- bg #040605, ECG trace #7fffaf, warn #ffb347, danger #ff5252, text #d8e6dc
- Font: IBM Plex Mono for numerics, Cormorant Garamond italic for ER subtitles

## Build

`npm install && npm run build` — must pass before commit.
