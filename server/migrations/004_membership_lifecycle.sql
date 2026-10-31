-- Membership lifecycle (invite → active → suspended) and revocable sessions.
-- Counterparts of the earlier project's invited/active/suspended memberships
-- and session-family revocation.

ALTER TABLE memberships
  ADD COLUMN status            text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended')),
  ADD COLUMN invited_by        uuid REFERENCES users(id),
  ADD COLUMN invite_expires_at timestamptz,
  ADD COLUMN activated_at      timestamptz DEFAULT now(),
  ADD COLUMN suspended_at      timestamptz,
  ADD COLUMN suspended_by      uuid REFERENCES users(id),
  ADD COLUMN suspend_reason    text;

-- Existing rows were created active.
UPDATE memberships SET activated_at = created_at;

ALTER TABLE memberships
  ADD CONSTRAINT memberships_invite_has_expiry CHECK (status <> 'invited' OR invite_expires_at IS NOT NULL),
  ADD CONSTRAINT memberships_active_has_time   CHECK (status <> 'active' OR activated_at IS NOT NULL),
  ADD CONSTRAINT memberships_suspend_reason    CHECK (status <> 'suspended' OR (suspended_at IS NOT NULL AND suspended_by IS NOT NULL AND length(suspend_reason) >= 5));

-- Sessions get an id the user can see, and are revoked instead of deleted.
ALTER TABLE sessions
  ADD COLUMN id            uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  ADD COLUMN last_used_at  timestamptz,
  ADD COLUMN revoked_at    timestamptz,
  ADD COLUMN revoke_reason text CHECK (revoke_reason IN ('logout','user_revoked','other_sessions_revoked'));

CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- Accepting, suspending and reactivating update a membership; cancelling a
-- pending invitation deletes it. Revoking a session is an UPDATE (already granted).
GRANT UPDATE, DELETE ON memberships TO goverhub_app;
