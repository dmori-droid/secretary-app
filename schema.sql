-- 秘書アプリ D1 スキーマ

CREATE TABLE IF NOT EXISTS memos (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reflections (
  id         TEXT PRIMARY KEY,
  week       TEXT NOT NULL UNIQUE,   -- 例: 2026-W30（1週1件）
  comment    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
