-- Migration: collapse every multi-tag task down to one tag
-- Created: 2026-07-27
--
-- A task carries AT MOST ONE tag. `tasks.tag` is a TEXT column that used to
-- hold space-separated tokens by convention, and every write path treated
-- tagging as "add to what's there" — dropping a task on a lane left it in the
-- old lane too. Those write paths now SET the tag, and the handlers normalize
-- anything an API or MCP caller sends, so nothing NEW can be written with two.
-- This is the one-time cleanup for rows written before that.
--
-- The rule is the same one the app applies: the LAST token wins, because the
-- last tag applied is the one the user meant.
--
-- The collapse is arithmetic, not pattern-matching, so a tag that happens to
-- contain another tag as a substring can't confuse it:
--   replace(t, ' ', '')  →  the set of every non-space character in the tag
--   rtrim(t, <that set>) →  strips trailing chars in that set, leaving the
--                           prefix up to and including the LAST space
--   substr(t, len + 1)   →  everything after it: the last token
-- Repeated spaces collapse correctly too ("a  b" → "b").
--
-- Re-runnable: the WHERE clause only matches rows that still hold a space, so a
-- second run updates nothing. Nothing is destroyed beyond the extra tags, which
-- is the point of the migration — the tasks themselves are untouched.

-- 1. Normalize surrounding whitespace first, so " alpha " can't read as multi-token.
UPDATE tasks
SET tag = trim(tag)
WHERE tag IS NOT NULL AND tag <> trim(tag);

-- 2. A tag that is now empty is no tag at all.
UPDATE tasks
SET tag = NULL
WHERE tag = '';

-- 3. Keep the last token of anything still holding more than one.
UPDATE tasks
SET tag = substr(tag, length(rtrim(tag, replace(tag, ' ', ''))) + 1)
WHERE tag IS NOT NULL AND tag LIKE '% %';
