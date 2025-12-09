-- WizBot SQLite Database Schema
-- Created: 2024-12-09

-- Enable foreign key enforcement
PRAGMA foreign_keys = ON;

-- Guild configuration
CREATE TABLE IF NOT EXISTS guilds (
  id TEXT PRIMARY KEY,
  raid_channel_id TEXT,
  museum_channel_id TEXT,
  audit_channel_id TEXT,
  creator_reminder_seconds INTEGER DEFAULT 1800,
  participant_reminder_seconds INTEGER DEFAULT 600,
  auto_close_seconds INTEGER DEFAULT 3600,
  last_auto_close_seconds INTEGER DEFAULT 3600,
  creator_reminders_enabled INTEGER DEFAULT 1,
  participant_reminders_enabled INTEGER DEFAULT 1,
  raid_leader_role_id TEXT
);

-- Active raids (most critical table)
CREATE TABLE IF NOT EXISTS raids (
  message_id TEXT PRIMARY KEY,
  raid_id TEXT,
  guild_id TEXT,
  channel_id TEXT,
  type TEXT DEFAULT 'raid',
  template_slug TEXT,
  template_data TEXT,  -- JSON for complex template info
  datetime TEXT,
  timestamp INTEGER,
  length TEXT,
  strategy TEXT,
  creator_id TEXT,
  max_slots INTEGER,
  creator_reminder_sent INTEGER DEFAULT 0,
  participant_reminder_sent INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  closed_at INTEGER
);

-- Raid signups (normalized from nested arrays)
CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_name TEXT NOT NULL,
  role_emoji TEXT,
  role_icon TEXT,
  group_name TEXT,
  slot_index INTEGER,
  slots INTEGER DEFAULT 1,
  is_waitlist INTEGER DEFAULT 0,
  side_assignment TEXT,
  signed_up_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (message_id) REFERENCES raids(message_id) ON DELETE CASCADE
);

-- Waitlist entries for museum signups
CREATE TABLE IF NOT EXISTS museum_waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES raids(message_id) ON DELETE CASCADE,
  UNIQUE(message_id, user_id)
);

-- User statistics (global)
CREATE TABLE IF NOT EXISTS user_stats (
  user_id TEXT PRIMARY KEY,
  total_raids INTEGER DEFAULT 0,
  role_counts TEXT,        -- JSON object
  template_counts TEXT,    -- JSON object
  weekday_counts TEXT,     -- JSON object
  last_updated INTEGER,
  last_raid_at INTEGER
);

-- User statistics per guild
CREATE TABLE IF NOT EXISTS guild_user_stats (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  total_raids INTEGER DEFAULT 0,
  role_counts TEXT,
  template_counts TEXT,
  weekday_counts TEXT,
  last_updated INTEGER,
  last_raid_at INTEGER,
  PRIMARY KEY (guild_id, user_id)
);

-- Admin roles per guild
CREATE TABLE IF NOT EXISTS admin_roles (
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, role_id)
);

-- Command-specific role permissions
CREATE TABLE IF NOT EXISTS command_permissions (
  guild_id TEXT NOT NULL,
  command_name TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, command_name, role_id)
);

-- Required roles to sign up for raids
CREATE TABLE IF NOT EXISTS signup_roles (
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, role_id)
);

-- User availability windows
CREATE TABLE IF NOT EXISTS availability (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  timezone TEXT,
  days TEXT,
  roles TEXT,
  notes TEXT,
  windows TEXT,  -- JSON array of parsed windows
  PRIMARY KEY (guild_id, user_id)
);

-- Template overrides (per-guild customization of base templates)
CREATE TABLE IF NOT EXISTS template_overrides (
  guild_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  name TEXT,
  emoji TEXT,
  description TEXT,
  color TEXT,
  disabled INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, template_id)
);

-- Custom templates (per-guild)
CREATE TABLE IF NOT EXISTS custom_templates (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT,
  description TEXT,
  color TEXT,
  role_groups TEXT  -- JSON array
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_raids_guild ON raids(guild_id);
CREATE INDEX IF NOT EXISTS idx_raids_timestamp ON raids(timestamp);
CREATE INDEX IF NOT EXISTS idx_raids_channel ON raids(channel_id);
CREATE INDEX IF NOT EXISTS idx_signups_message ON signups(message_id);
CREATE INDEX IF NOT EXISTS idx_signups_user ON signups(user_id);
CREATE INDEX IF NOT EXISTS idx_guild_user_stats_guild ON guild_user_stats(guild_id);
CREATE INDEX IF NOT EXISTS idx_availability_guild ON availability(guild_id);
CREATE INDEX IF NOT EXISTS idx_custom_templates_guild ON custom_templates(guild_id);
