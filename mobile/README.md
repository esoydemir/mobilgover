# GoverHub Business Mobile

Expo (React Native + TypeScript) implementation of the Claude Design prototype in
`../project/GoverHub Mobile.dc.html`: Uyum dark/lime design language, Turkish-first
copy with English sublabels, four personas and every screen of the prototype.

## Run

```bash
npm install
npx expo start          # i / a for simulators, or scan with a development build
npx expo start --web    # browser; wide windows show the app in a 390×844 phone frame
npm run typecheck
```

## Structure

- `src/app/` — Expo Router routes, one file per screen (`index` is the persona home).
- `src/screens/` — the four persona home screens rendered by `index`.
- `src/components/` — floating tab bar, AssistiveTouch-style assistant button,
  bottom sheet, toast, score rings, shared UI primitives.
- `src/state/app.tsx` — persona, task completion, sheet/toast state and navigation helpers.
- `src/data/` — mock data for "Kahve Durağı" (Kadıköy).
- `src/theme/` — colour tokens and the `type()` text-style helper
  (CSS px / em / line-height multipliers → React Native).

## Notes

- Personas are switched from **Ayarlar → Rol / Persona** (the prototype did this
  from a side rail outside the phone).
- All data is mocked; actions show the same toasts and navigate exactly as the prototype.
