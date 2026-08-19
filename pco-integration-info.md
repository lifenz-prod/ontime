# PCO Integration Knowledge — LIFE NZ Setup & Runsheet Pulling

This document captures everything learned while building and hardening the Planning Center Online (PCO) integration for the LIFE NZ Lookbook app — including the non-obvious workarounds that were required to pull runsheet data correctly. It is written for future maintainers and forked instances.

Related docs:
- `docs/LOOKBOOK_USER_GUIDE.md` — end-user guide (generation, Media No. behavior, troubleshooting)
- `DUPLICATING.md` — new-instance setup runbook (secrets don't copy on fork; PCO Setup mapping steps)
- `replit.md` — project overview and required env vars

---

## 1. Authentication

- All PCO calls are **server-side only** (`server/pcoClient.ts`). Credentials never reach the browser.
- HTTP Basic auth is built from the `PCO_APP_ID` and `PCO_SECRET` environment secrets: `Basic base64(appId:secret)`. These are a PCO **Personal Access Token** pair created at https://api.planningcenteronline.com/oauth/applications.
- Missing credentials throw a 401-style error with setup guidance before any request is made.
- Error mapping in `pcoFetch`:
  - **401** → "Invalid PCO credentials. Check PCO_APP_ID and PCO_SECRET." (wrong/revoked token)
  - **403** → "PCO access denied. Check your API permissions." (token valid but lacks Services product access)
  - Other HTTP errors → surfaced with status + body text
  - Network failures → 500 "Failed to connect to Planning Center"
- **Diagnostics flow** (`testConnection`, exposed at `GET /api/pco/diagnostics`, shown on the Admin → PCO Setup page): reports whether each env var is *present* (never the values), then live-tests the connection by fetching `/service_types`. The setup UI only enables the service list fetch once diagnostics reports "connected".
- On fork/duplication: secrets do **not** copy. Both `PCO_APP_ID` and `PCO_SECRET` must be re-entered in the new Repl (see `DUPLICATING.md`).

## 2. API Endpoints Used

Base URL: `https://api.planningcenteronline.com/services/v2`

| Endpoint | Purpose |
|---|---|
| `GET /service_types` | Discover all PCO service types (diagnostics + mapping picker) |
| `GET /service_types/:id` | Resolve a service type's display name |
| `GET /service_types/:id/plans?filter=after,before&after=...&before=...` | Find plans in a date window |
| `GET /plans/:planId` | Manual linking by plan URL/ID |
| `GET /plans/:planId/items?include=item_notes` | Pull the runsheet items + Media No. notes |

App-facing routes (all require app auth): `/api/pco/diagnostics`, `/api/pco/services`, `/api/pco/plans`, `/api/pco/plan/:planId/items`, plus mapping CRUD at `/api/pco/mappings`.

## 3. Pagination — Required Workaround

LIFE NZ has enough service types and plan items that PCO's default page size silently truncates results. Fixes in `pcoFetchAllPages`:

- Force `per_page=100` (PCO's max) on every list request unless already present.
- Follow the JSON:API `links.next` URL until absent, accumulating both `data` **and** `included` arrays across pages.
- Record pagination diagnostics (page count, total items, whether pagination occurred) and surface them in the PCO Setup UI so truncation is visible rather than silent.

This applies to service types, plans, and plan items alike. **Never** fetch a single page of any PCO list.

## 4. Date Matching — Required Workaround

PCO's `after`/`before` plan filters proved too broad/unreliable for finding "the plan on this exact Sunday". The working approach (`fetchPlansForDate` + `autoLinkPlan`):

1. Query plans in a **±7-day window** around the target date.
2. In app code, exact-match the calendar date (year/month/day comparison) against each plan's date.
3. Plan date is taken from `attributes.sort_date` (preferred, split at `T`); if absent, fall back to parsing the human-readable `attributes.dates` string (e.g. `"1 February 2025"`) with an explicit month-name table.
4. Service time is extracted as the first 5 chars (`HH:MM`) of the time portion of `sort_date`, and copied onto the week record when a plan is linked.

## 5. Auto-Link Rules

Auto-linking runs when a week/service is created and when a manual override is cleared:

- Requires a saved **service-type mapping** (app service type → PCO service type ID). No mapping → status `none`.
- The app service type is extracted from the service name (longest-match against the DB-backed service type list, e.g. `"North AM 1st February"` → `"North AM"`).
- After date filtering: **exactly one** matching plan → auto-linked (`linked`); zero → `none`; multiple → `multiple` with candidates for manual selection.
- Note: the mapping ID + exact date are decisive; the resolver does not additionally compare the plan's name against the service type name.
- On successful link, the plan's ID/URL/service-type ID are stored on the service, and the lookbook is auto-generated immediately.

## 6. Runsheet Reality — What "Runsheet Data" Actually Is

**There are no PCO teams, people, positions, or schedule endpoints in this integration.** The usable runsheet is reconstructed entirely from:

- **Plan items** (`/plans/:id/items`), plus
- **Included `ItemNote` records** requested via `?include=item_notes`.

Extraction rules (`fetchPlanItems`):
- Filter `included` to `type === "ItemNote"`, deduplicating by note ID (duplicates appear across pages because `included` is accumulated per page).
- Only notes whose trimmed `attributes.category_name` **exactly equals** `Media No.` (configurable via `?mediaNoField=`, but generation always uses the default) contribute — the note's `content` becomes the item's `mediaNo`.
- Notes are indexed by `relationships.item.data.id` to attach them to the right item.
- Plan items are deduplicated by item ID, and **items without a non-blank Media No. are discarded** — they never appear in the lookbook.

In PCO terms: the LIFE NZ production team maintains a custom item-note category named exactly **"Media No."** on each Services plan item; that field drives everything.

## 7. Media No. Segment Parsing

`parseMediaNoSegments` (`shared/schema.ts`) turns one Media No. field into independent lookbook entries:

- **Split** on: newlines, bullets (`•`/`·`), spaced dot (` . `), spaced dash/em-dash (` - ` / ` — `).
- A bare `---` segment is discarded.
- A parenthesized `(label)` inside a segment becomes the entry's display label.
- Segments containing `VSUI-...` are treated as non-graphic media and yield no codes.
- Codes are matched with a strict campus-aware regex: campus letter prefix(es) + `A` with **1–3 digits**, or `B`/`F`/`T` with **exactly 3 digits** (e.g. `CB043`, `CF224`, `CA1`, `CT001`). Codes are uppercased.
- Within a segment, the **first** code of each type (background/foreground/A-screen/lower-third) wins.
- Text-only segments are kept by the parser but skipped during generation (only segments with at least one valid code create items).

### No background carry-forward (deliberate)

Each segment stands alone. Generation explicitly passes `undefined` as the default background, so a foreground-only segment renders on a grey backing with a "Missing background" badge instead of silently inheriting the previous segment's background. This was a deliberate correctness decision — inherited backgrounds caused wrong previews. Do not "fix" this by re-adding carry-forward.

## 8. LIFE NZ Service-Type Setup & Mapping

- App service types are **DB-backed** (`service_types` table: name, optional `campusKey`, `isBuiltIn`, `sortOrder`) — not hardcoded. Admins can add custom types.
- PCO mappings live in the `pco_service_mappings` table: `appServiceType` (unique) → `pcoServiceTypeId` + `pcoServiceTypeName`. Managed via Admin → PCO Setup (admin role required for writes).
- The setup page fetches the **complete, paginated** live PCO service-type list and lets the admin pick per app type. A relevance-scoring heuristic sorts choices and tags a "Best match" — but it is a **suggestion only**; the saved mapping is always an explicit admin choice.
- Campus association (which screen layout/mask applies) is configured on the service type independently of the PCO mapping. Campus resolution priority when creating a service: explicit request > service type's configured campus > inference from the service name.

## 9. Manual Linking

- Admins can paste a PCO plan URL or ID. The URL parser accepts only `/plans/<digits>`.
- If the ID parses and fetches, the plan is linked with `manualOverride: true` / status `manual`.
- If the URL can't be parsed or fetched, the **raw URL is still stored** as an override so the link isn't lost — the service just won't auto-generate.
- "Clear override" wipes manual link data and re-runs the auto-link algorithm.

## 10. Generation Flow Summary

1. Service must have a linked plan ID.
2. Existing items are snapshotted (for diffing) then cleared.
3. `fetchPlanItems` pulls all pages of plan items + Media No. notes.
4. Each Media No. is segment-parsed; each code-bearing segment becomes one lookbook item, preserving plan-item title, label, raw Media No., and order.
5. Previews are composited per segment (no background inheritance), with campus screen mask applied when one is active.
6. Results report resolved assets, missing codes (with plan-item context for targeted uploads), and unused library assets.

## 11. Troubleshooting Quick Reference

| Symptom | Likely cause |
|---|---|
| "PCO credentials not configured" | `PCO_APP_ID`/`PCO_SECRET` missing (common right after forking) |
| 401 Invalid credentials | Token wrong or revoked — recreate the Personal Access Token |
| 403 Access denied | Token lacks Services product permission in PCO |
| Service won't auto-link | No mapping saved in PCO Setup, or no/multiple plans on that exact date |
| Items missing from lookbook | Plan item has no "Media No." note, note is in a differently-named category, or codes don't match the strict format |
| Some service types missing in picker | Should not happen — pagination fetches all pages; check pagination diagnostics on PCO Setup |
| Foreground shows grey/"Missing background" | Segment lacks a B-code; this is intentional (no carry-forward) — add the background code to that segment in PCO |

See `docs/LOOKBOOK_USER_GUIDE.md` for user-facing troubleshooting and `DUPLICATING.md` for setting all of this up on a fresh instance.
