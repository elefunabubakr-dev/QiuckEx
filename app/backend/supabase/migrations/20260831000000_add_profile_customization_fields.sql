-- FE-1151: Profile customization fields for the settings page
--
-- `GET`/`PUT /profile` and the public `GET /username/:username` surface expose a
-- small set of per-profile presentation fields (theme colour, avatar, bio and
-- social handles). They live on `usernames` because the public profile is
-- already keyed by username: `app/frontend/src/app/[username]/page.tsx` renders
-- `/username/:username`, so the customization must hang off the same row rather
-- than a separate wallet-level table that would have to be joined on every read.
--
-- `username` is deliberately NOT editable here. `username_marketplace.username`
-- is a FK to `usernames.username` with ON DELETE CASCADE, so renaming through
-- this path would silently destroy a user's marketplace listings. Renames stay
-- in the username-claim flow.
--
-- Every column is nullable with a NULL default so existing rows stay valid and
-- an unconfigured profile reports "not set" rather than a placeholder value.

ALTER TABLE usernames ADD COLUMN IF NOT EXISTS primary_color TEXT;
ALTER TABLE usernames ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE usernames ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE usernames ADD COLUMN IF NOT EXISTS twitter_handle TEXT;
ALTER TABLE usernames ADD COLUMN IF NOT EXISTS discord_handle TEXT;
ALTER TABLE usernames ADD COLUMN IF NOT EXISTS github_handle TEXT;

COMMENT ON COLUMN usernames.primary_color IS 'Profile accent colour as a #RRGGBB hex string; NULL = use the app default';
COMMENT ON COLUMN usernames.avatar_url IS 'Absolute https URL of the profile avatar image; NULL = render the username initial';
COMMENT ON COLUMN usernames.bio IS 'Free-text profile description, max 160 characters';
COMMENT ON COLUMN usernames.twitter_handle IS 'X/Twitter handle without the leading @; NULL = hide the link';
COMMENT ON COLUMN usernames.discord_handle IS 'Discord display name; NULL = hide the link';
COMMENT ON COLUMN usernames.github_handle IS 'GitHub handle without the leading @; NULL = hide the link';

-- Enforce the colour format in the database as well as in the DTO: this column
-- is interpolated into inline styles on the frontend, so a malformed value is a
-- rendering hazard, not just a cosmetic one.
ALTER TABLE usernames
  DROP CONSTRAINT IF EXISTS usernames_primary_color_format_chk;

ALTER TABLE usernames
  ADD CONSTRAINT usernames_primary_color_format_chk
  CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9a-fA-F]{6}$');
