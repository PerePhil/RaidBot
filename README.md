# WizBot

A Discord bot for managing raid signups in Wizard101. Supports multiple raid types with reaction-based signups, role management, reminders, and per-guild customization.

## Features

- **Raid Management** — Create and manage raids for Dragonspyre (Voracious Void), Lemuria (Ghastly Conspiracy), and Polaris (Cabal's Revenge)
- **Recurring Raids** — Schedule automatic raid creation on a weekly, daily, or custom interval with optional custom spawn times
- **Museum Signups** — Separate signup system for museum runs with auto-lock at start time
- **Reaction-Based Signups** — Users react with role emojis to sign up; automatic waitlist management with DM notifications
- **Smart Reminders** — Configurable creator and participant reminders with auto-close for full raids
- **Natural Language Time Parsing** — "tomorrow 7pm", "next Friday 6:30", or Unix timestamps
- **Role-Based Permissions** — Per-guild admin roles and command-specific permissions
- **Unified Stats & Analytics** — Track participation, attendance rates, weekly/monthly trends, inactive members, and CSV export
- **Availability Tracking** — Users can record their availability preferences
- **Customizable Templates** — Enable/disable or rename raid templates per guild
- **Rate Limiting** — Prevents spam with configurable cooldowns on reactions and commands
- **Graceful Shutdown** — Safe shutdown with state preservation

## Commands

| Command | Description |
|---------|-------------|
| `/create` | Interactive raid/museum creation flow |
| `/raid` | Management panel (Close, Reopen, Delete, Change Time) |
| `/recurring` | Manage recurring raid schedules (create, list, delete, toggle, trigger) |
| `/raidsignup` | Admin signup edits (assign, remove, side assignment) |
| `/raidinfo` | List, view details, or export raids as .ics |
| `/setchannel` | Configure raid/museum/audit channels |
| `/settings` | Reminder and auto-close configuration |
| `/templates` | Enable/disable or rename raid templates |
| `/stats` | Unified stats: user, server, weekly, monthly, inactive, export |
| `/availability` | Record/view user availability |
| `/permissions` | Configure role-based permissions |
| `/changelog` | View current release notes |
| `/help` | Command documentation |
| `/ping` | Bot health check and status |

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create `config.json` with your bot credentials:
   ```json
   {
     "clientId": "YOUR_CLIENT_ID",
     "token": "YOUR_BOT_TOKEN",
     "allowedGuildIds": ["GUILD_ID_1", "GUILD_ID_2"]
   }
   ```
   - `allowedGuildIds` is optional; leave empty to allow all guilds

   **Or use environment variables:**
   ```bash
   export DISCORD_CLIENT_ID="YOUR_CLIENT_ID"
   export DISCORD_TOKEN="YOUR_BOT_TOKEN"
   export DISCORD_ALLOWED_GUILDS="GUILD_ID_1,GUILD_ID_2"
   ```

4. Run the bot:
   ```bash
   node bot.js
   ```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DISCORD_CLIENT_ID` | Bot client ID | — |
| `DISCORD_TOKEN` | Bot token | — |
| `DISCORD_ALLOWED_GUILDS` | Comma-separated guild IDs | All guilds |
| `LOG_LEVEL` | Logging verbosity: DEBUG, INFO, WARN, ERROR | INFO |
| `LOG_TO_FILE` | Enable file logging | false |

## Project Structure

```
├── bot.js                 # Main entry point
├── commands/              # Slash command implementations
├── raids/                 # Raid logic and reaction handlers
├── utils/                 # Utility functions
│   ├── config.js          # Configuration loader
│   ├── logger.js          # Structured logging
│   ├── validators.js      # Input validation
│   ├── rateLimiter.js     # Rate limiting
│   ├── errorMessages.js   # User-friendly errors
│   ├── dmRetry.js         # DM retry logic
│   └── ...
├── data/                  # Persistent data (gitignored)
│   └── wizbot.db          # SQLite database
├── db/                    # Database layer
│   ├── database.js        # Connection wrapper
│   ├── schema.sql         # Schema definition
│   └── migrate.js         # JSON → SQLite migration
├── state.js               # State management and persistence
├── presence.js            # Bot presence/status updates
├── reminderScheduler.js   # Reminder and auto-close scheduler
├── auditLog.js            # Audit logging functionality
├── availabilityManager.js # User availability tracking
└── templatesManager.js    # Raid template customization
```

## Testing

```bash
npm test
```

Uses Node.js built-in test runner. Tests cover time parsing, state persistence, waitlist promotion, and more.

## Database

WizBot uses SQLite for data persistence. The database file is stored at `data/wizbot.db`.

**Migrating from JSON (if upgrading):**
```bash
node db/migrate.js
```

This imports existing JSON data and backs up the original files.

## Dependencies

- [discord.js](https://discord.js.org/) — Discord API library
- [chrono-node](https://github.com/wanasit/chrono) — Natural language date parsing
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — Fast, synchronous SQLite

## License

ISC
