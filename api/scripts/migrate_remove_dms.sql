-- Remove DM feature: drop dm_messages, dm_participants, dm_threads tables
DROP TABLE IF EXISTS dm_messages CASCADE;
DROP TABLE IF EXISTS dm_participants CASCADE;
DROP TABLE IF EXISTS dm_threads CASCADE;
