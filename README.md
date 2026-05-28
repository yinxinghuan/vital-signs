# Vital Signs

> Night shift. You're the only one awake. A friend has crashed in the dream-ER. Their pulse is in your finger.

A rhythm survival game in the AlterU After Dark series. Single tap to keep a random Aigram friend's heartbeat alive against a drifting BPM target. Miss too many beats → flatline. Over-tap → V-fib. On death, an AI-typed death certificate + cold-tone morgue portrait stamps onto the community Fate Wall.

## Phases

`splash → playing → dying → certificate → wall`

## Dev

```
npm install
npm run dev
npm run build
```

## Demo states

Visit with `#demo=<phase>` to jump in:
- `#demo=splash`
- `#demo=playing`
- `#demo=dying`
- `#demo=certificate`
- `#demo=wall`

## Deploy

GitHub Pages via `.github/workflows/pages.yml` — push to `master`, auto-builds + publishes.

## Stack

React 18 + TypeScript + Less + Vite. Aigram runtime via `@shared` (useChat / useGenImage / useGameSave + canonical bridge). Canvas ECG. Web Audio synth (lub-dub thump + soft metronome + flatline drone + V-fib noise).
