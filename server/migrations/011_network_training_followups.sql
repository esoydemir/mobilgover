-- Training follow-ups and the first version of the professional network.
-- Additive: no existing row is changed or removed.

-- Whether someone other than the author approved the published version (false: single manager published own content).
ALTER TABLE training_versions ADD COLUMN independent_review boolean;
-- A retraining after "not effective in the field" points to the earlier assignment (which stays as it was).
ALTER TABLE training_assignments ADD COLUMN previous_assignment_id uuid REFERENCES training_assignments(id);

-- ─── Professional network (first version) ───────────────────────────────────────────
-- A network profile is the person's own statement. It grants nothing: offering a service still
-- needs an approved category authorisation (service_authorizations), checked by the server.
ALTER TABLE platform_roles DROP CONSTRAINT platform_roles_role_check;
ALTER TABLE platform_roles ADD CONSTRAINT platform_roles_role_check
  CHECK (role IN ('rule_author','rule_reviewer','platform_admin','marketplace_reviewer','network_moderator'));

CREATE TABLE network_profiles (
  user_id        uuid PRIMARY KEY REFERENCES users(id),
  display_name   text NOT NULL,
  title          text NOT NULL DEFAULT '',
  bio            text NOT NULL DEFAULT '',
  city           text NOT NULL,
  district       text,
  specialties    text[] NOT NULL DEFAULT '{}',
  -- Categories the person SAYS they work in; approval is separate (service_authorizations).
  categories     text[] NOT NULL DEFAULT '{}',
  photo_key      text,
  photo_mime     text,
  -- Contact details are hidden from network users unless the person opts in.
  phone          text,
  show_email     boolean NOT NULL DEFAULT false,
  show_phone     boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  suspended_reason text,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE network_experience (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES network_profiles(user_id),
  role_title   text NOT NULL,
  organization text NOT NULL DEFAULT '',
  start_year   integer NOT NULL CHECK (start_year BETWEEN 1950 AND 2100),
  end_year     integer CHECK (end_year IS NULL OR end_year >= start_year),
  description  text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE network_follows (
  follower_id uuid NOT NULL REFERENCES network_profiles(user_id),
  followee_id uuid NOT NULL REFERENCES network_profiles(user_id),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE TABLE network_blocks (
  blocker_id uuid NOT NULL REFERENCES network_profiles(user_id),
  blocked_id uuid NOT NULL REFERENCES network_profiles(user_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
-- Posts are user content. There is deliberately no field that could mark one as official or approved.
CREATE TABLE network_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     uuid NOT NULL REFERENCES network_profiles(user_id),
  kind          text NOT NULL DEFAULT 'post' CHECK (kind IN ('post','case')),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','deleted')),
  body          text NOT NULL,
  -- Case share: only the fields shown in the preview, anonymised; with who allowed it and when.
  case_snapshot jsonb,
  case_company_id uuid REFERENCES companies(id),
  case_ncr_id   uuid,
  case_permitted_by uuid REFERENCES users(id),
  case_permitted_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at  timestamptz,
  edited_at     timestamptz,
  deleted_at    timestamptz,
  hidden_at     timestamptz,
  hidden_reason text,
  CHECK (kind <> 'case' OR (case_snapshot IS NOT NULL AND case_permitted_by IS NOT NULL AND case_permitted_at IS NOT NULL))
);
CREATE TABLE network_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES network_posts(id),
  author_id   uuid NOT NULL REFERENCES network_profiles(user_id),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  edited_at   timestamptz,
  deleted_at  timestamptz,
  hidden_at   timestamptz,
  hidden_reason text
);
CREATE TABLE network_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid NOT NULL REFERENCES users(id),
  target_type  text NOT NULL CHECK (target_type IN ('post','comment','profile')),
  target_id    uuid NOT NULL,
  reason       text NOT NULL CHECK (reason IN ('misleading','personal_data','commercial_data','harassment','spam','other')),
  details      text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  decision     text CHECK (decision IN ('hide','dismiss','suspend_profile')),
  decision_notes text,
  handled_by   uuid REFERENCES users(id),
  handled_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (status = 'open' OR (handled_by IS NOT NULL AND handled_at IS NOT NULL AND length(decision_notes) >= 10))
);
CREATE UNIQUE INDEX network_reports_once ON network_reports (reporter_id, target_type, target_id) WHERE status = 'open';

-- A request may be sent to one provider chosen from their profile (others do not see it).
ALTER TABLE service_requests ADD COLUMN invited_profile_id uuid REFERENCES professional_profiles(id);

-- Network tables are not business data: no tenant policy; the API decides who sees what.
GRANT SELECT, INSERT, UPDATE ON network_profiles, network_posts, network_comments, network_reports TO goverhub_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON network_experience, network_follows, network_blocks TO goverhub_app;
