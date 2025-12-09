# WizBot – Quick Guide for Agents

## Mission
- Discord raid signup bot for Wizard101. Supports raids (Dragonspyre/Voracious Void, Lemuria/Ghastly Conspiracy, Polaris/Cabal’s Revenge) and museum signups. Goal: smooth signup UX, moderator tools, reminders, and readable embeds without user pings.

## Key Commands (slash)
- `/create` — interactive flow for raid/museum creation (asks only for needed fields: length, strategy for Dragonspyre, etc.).
- `/raid` — management panel (Close, Reopen, Delete, Change Time via modal).
- `/raidsignup action:<assign|remove|side>` — admin signup edits; `side` only for Lemuria.
- `/raidinfo action:<list|detail|export>` — list, detail, or export upcoming raids as .ics.
- `/setchannel` — interactive raid/museum channel picker and audit-log channel configurator.
- `/settings` — reminders + auto-close panel (creator/participant reminders; auto-close timings up to 24h) and optional raid leader role (⭐ marker on signups).
- `/templates` — enable/disable or rename raid templates per guild.
- `/raidstats [user] [scope:<user|server|inactive>]` — participation stats (totals, favorite roles/raid types, active day), top server participants, or members with zero recorded raids.
- `/availability [user]` — record/view availability (days/times/timezone/preferences).
- `/permissions` — panel to set which roles (in addition to Manage Server) can use admin commands, plus signup eligibility for raids/museums.
- `/changelog` — current release notes.

## Interaction Patterns
- Embeds use bold display names (no pings) beside roles.
- Date + Time is always a dedicated field (first in embeds); change-time replaces the field and updates embed timestamp.
- Raid panel buttons auto-refresh state after actions; delete disables the panel.
- Channel/settings panels disable after collector timeout.

## Time Parsing & Validation
- Uses `chrono-node` (`parseDateTimeToTimestamp`) for natural language (“tomorrow 7pm”, “next Friday 6:30”). Numeric timestamps accepted. ISO date strings allowed. Invalid strings reply with an error.

## Settings & Scheduler
- Per-guild settings stored in `guild_settings.json`; defaults: creator reminder 30m, participant 10m, auto-close 60m. Auto-close toggle remembers last duration.
- Reminder scheduler respects per-guild settings; auto-closes full raids if enabled. Reminder flags persist to disk. Auto-close executed flag stored on the raid object.
- Raid leader role (per guild): set in `/settings`. Members with that role display with a ⭐ in signup embeds (roles, waitlists) and `/raidinfo detail`.

## Data & Persistence
- All persistent files now live in `data/` (e.g., `data/active_raids.json` + `.bak`, `data/guild_settings.json`, `data/raid_channels.json`, `data/museum_channels.json`, `data/raid_stats.json`, `data/availability.json`, `data/template_overrides.json`, `data/raid_templates.json`).
- `state.js` exposes load/save helpers and `recordRaidStats` (called when closing a raid) to tally user participation.

## Signup Rules
- Reaction-based signup. Each role uses its emoji; museum uses ✅. Waitlists per role; auto-promotion on openings with DM notifications.
- Lemuria side assignment only when type is Lemuria (handled in `/raidsignup side`).
- Closing removes reactions; reopening re-adds them and updates status.

## UX Choices
- Embeds list Date + Time first, then role groups. Status and Raid ID retained at bottom. Signup description omits mention tags to reduce clutter.
- Management panel shows signup link in the description.
- Settings panel uses buttons/toggles and dropdowns; `/setchannel` uses channel selects.

## Testing
- `npm test` (Node test runner) covers chrono parsing, state persistence, waitlist promotion.
- No git repo here by default; check for dirty files before heavy changes.

## Deployment Notes
- Re-register slash commands after shape changes (e.g., new `/create`, `/changelog`, `/raidinfo export` action).
- Env: `config.json` with `clientId`, `token`, `allowedGuildIds`.

## Known Constraints / Watchouts
- Stats are recorded on close; reopening doesn’t subtract. Auto-close uses “full and within window”; ensure `autoCloseExecuted` stays in raidData once used.
- Panels are single-user (the invoker). Adjust collector filter if multi-admin use is needed (currently intentionally locked to invoker).
- Time modal and creation reject unparseable strings; ensure chrono locale defaults are fine for your audience.
