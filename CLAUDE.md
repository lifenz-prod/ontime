# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ontime is a browser-based application for managing event rundowns, scheduling, and cueing in live events (broadcast, theatre, conferences, houses of worship). A Node server holds the canonical rundown/runtime state and pushes it over WebSocket to many browser-based "views" (timer, backstage, public, operator, cuesheet, etc.) on the local network. Electron wraps the same client+server for desktop distribution.

This is a **fork** (`lifenz-prod/ontime`, upstream `cpvalente/ontime`) carrying custom features for a specific church/worship workflow — see "Fork-specific features" below.

## Monorepo layout

pnpm + turbo workspace (`pnpm-workspace.yaml`, `turbo.json`). Node ~20, pnpm ~9.

- `apps/client` — React UI and all browser views (Vite). The bulk of frontend work happens here.
- `apps/server` — Node app; owns rundown data, runtime/playback engine, integrations (OSC/HTTP/WS), Google Sheets import.
- `apps/electron` — Electron wrapper for cross-platform desktop builds. Not needed for local dev.
- `apps/cli`, `apps/spec` — CLI launcher and OpenAPI/spec assets.
- `packages/types` — shared TypeScript types (rundown entries, API DTOs, definitions). Source of truth for data shapes shared across client/server.
- `packages/utils` — shared pure logic (date/time, rundown, cue, playback, validation utilities). Prefer putting cross-cutting pure functions here.

Shared dep versions are pinned via the pnpm `catalog:` mechanism in `pnpm-workspace.yaml` — reference `catalog:` in package.json rather than hardcoding versions for catalogued deps.

## Commands

All run from the project root unless noted.

- Install: `pnpm i`
- Dev (client + server together): `turbo dev` or `pnpm dev`
- Dev server only: `pnpm dev:server` · client only: `cd apps/client && pnpm dev`
- Backend debug (breakpoints): `cd apps/server && pnpm dev:inspect`
- Lint: `pnpm lint` (turbo across workspaces)
- Typecheck: `turbo run typecheck` (CI uses the workspace-pinned tsc; see commit 17ffec68)
- Build for local run: `pnpm build:local` (required before E2E)
- Unit tests (all, single run): `turbo test:pipeline`
- Unit tests (watch, single app): `cd apps/client && pnpm test` (or `apps/server`, `packages/utils`)
- Run a single unit test: vitest — `cd apps/server && pnpm test path/to/file.test.ts` or `pnpm test -t "test name"`
- E2E (Playwright): `pnpm e2e` (build first); interactive `pnpm e2e:i` (start server with `pnpm dev:server`); `pnpm e2e --ui` / `pnpm e2e --headed`
- Electron dist: `turbo build:electron` then `turbo dist-mac:local` / `dist-win` / `dist-linux` (notarised `dist-mac` only works in CI)

Default dev server runs at `http://localhost:4001`. Views are reached as path routes, e.g. `/timer`, `/backstage`, `/public`, `/editor`, plus the fork's `/ipad-editor`.

## Architecture

### Server (`apps/server/src`)
- The server is the single source of truth. The **rundown cache** (`services/rundown-service/rundownCache.ts`) holds the normalised rundown and is recomputed on edits; `RundownService.ts` is the orchestration entry point for rundown mutations.
- The **runtime/playback engine** (`services/runtime-service`, `EventTimer.ts`, `Clock.ts`, `timerUtils.ts`, `rollUtils.ts`) tracks the live state: what's playing, elapsed/remaining time, roll mode, added time, delays. `effectiveSchedule.ts` computes projected times.
- State is broadcast to clients over WebSocket; integrations (OSC, HTTP, Websocket API, qlab-service) live under `api-integration` / `services`. `sheet-service` handles Google Sheets import/export.
- Data persists to a project file DB; E2E runs against a separate test-db.
- Entry: built from `app.js` → output `index.cjs` (an Electron quirk; `index.ts` only takes over init when Electron is absent). See `DEVELOPMENT.md` "APP Building".

### Client (`apps/client/src`)
- `AppRouter.tsx` maps URL paths to views. Each view targets one role/task.
- `features/` holds the major UI areas: `rundown` (the editable event list + event blocks), `control` (playback controls), `editors`, `app-settings` (settings panels), `overview`, `operator`, `viewers`.
- State: Zustand stores in `common/stores` (notably `runtime.ts` for live runtime state, `appModeStore.ts`). Server data is fetched/synced via React Query hooks in `common/hooks-query` and `common/api`. Live updates arrive over WebSocket and update the runtime store.
- Mutations go through `useEventAction` and the API layer rather than editing local state directly.

### Time model
Events can be end-anchored ("Countdown to Time" / LockEnd) and count down to a time of day, or run as fixed-duration timers. Recent fork work **inverted the time-linking model** (commit 72aa007d): editing an event's start stretches the *previous* event. Keep this in mind when touching time linking / `link` logic.

## Fork-specific features

This fork serves a church running exact-replica 9am/11am Sunday services. Two interrelated features (see memory files for full design rationale):

### iPad Editor (`/ipad-editor`)
A simplified, touch-first editor for volunteers (the standard Mobile Editor was too complex). Components are prefixed `Ipad*` (`IpadEditor.tsx`, `IpadRundownWrapper.tsx`, `IpadRundownEventEditor.tsx`, `IpadPlaybackControl.tsx`, etc.). `RundownModeContext.tsx` gates UI affordances (e.g. hides row actions in iPad mode); `Rundown.tsx` adds a long-press TouchSensor for drag. Several global label/icon renames came with it (e.g. "External Message" → "Stage Message", "Count to end" → "Countdown to Time").

### Dual service mode
Generated 9am/11am replica service sections so playback runs continuously across both services.
- Both sections coexist in one rundown: rehearsal → **9am master** → generated **11am**. 9am END auto-plays into 11am "doors open" — it is NOT a flip-times toggle.
- **9am is master; 11am is fully re-derived (delete + rebuild) on any master edit.** Mirror is forward-only — 11am-only edits do not propagate back and are wiped on next re-derive. Guard logic for not disturbing a loaded/playing generated section lives in `RundownService.regenerateServiceInstances` (`serviceInstanceUtils.ts`).
- The boundary is a designated rundown block (`serviceProfiles.boundaryBlockId`); rehearsal entries before it run once and are never duplicated.
- Config flows primarily through **Google Sheet import** — morning/evening are tabs; service config is expressed inline via `service` timer-type rows (name + offset) and a `service boundary` column. The user relies heavily on sheet import, so any related feature must work through the import path.
- iPad/mobile PRE/9am/11am tabs are view filters only; the PRE tab is synthesized client-side.
- Settings UI: `features/app-settings/panel/service-profiles-panel`.

## Working conventions

- **Make changes in the main repo** (`/Users/alanaiken/Documents/GitHub/ontime`), not in worktrees — the running app is served from here, so worktree edits don't take effect until merged.
- Shared types belong in `packages/types`; shared pure logic in `packages/utils` — don't duplicate these in apps.
- Linting/formatting: ESLint + Prettier (`.eslintrc`, `.prettierrc`). Keep CI green: lint, typecheck, and tests across workspaces.
- License: AGPL-3.0-only.
