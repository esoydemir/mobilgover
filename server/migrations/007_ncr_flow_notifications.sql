-- Nonconformity flow v2, in-app notifications, override review, task cancellation codes.
-- Additive: no existing row is removed. Earlier step records are kept as they are and
-- copied into the new structures so old cases read the same in the new screens.

-- ─── Nonconformity: source, flow version, iteration, assignment trail ───────────
ALTER TABLE nonconformities ADD COLUMN source text NOT NULL DEFAULT 'task' CHECK (source IN ('task','manual'));
-- 1 = recorded before this migration (old step model), 2 = current flow.
ALTER TABLE nonconformities ADD COLUMN flow_version smallint NOT NULL DEFAULT 2;
UPDATE nonconformities SET flow_version = 1;
-- Each failed verification or reopening starts a new round of action → effectiveness check → verification.
ALTER TABLE nonconformities ADD COLUMN iteration integer NOT NULL DEFAULT 1;
ALTER TABLE nonconformities ADD COLUMN reopened_count integer NOT NULL DEFAULT 0;
ALTER TABLE nonconformities ADD COLUMN assigned_by uuid REFERENCES users(id);
ALTER TABLE nonconformities ADD COLUMN assigned_at timestamptz;
ALTER TABLE nonconformities ADD COLUMN severity text CHECK (severity IN ('minor','major','critical'));
UPDATE nonconformities SET severity = risk_rationale->>'severity' WHERE risk_rationale ? 'severity';

-- Steps (containment, effectiveness check) can now repeat per round.
ALTER TABLE ncr_steps ADD COLUMN iteration integer NOT NULL DEFAULT 1;
ALTER TABLE ncr_steps DROP CONSTRAINT ncr_steps_ncr_id_step_key;
CREATE UNIQUE INDEX ncr_steps_per_round ON ncr_steps (ncr_id, step, iteration);

-- ─── Cause assessment: first assessment and verified root cause kept apart ──────
CREATE TABLE ncr_cause_assessments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  ncr_id      uuid NOT NULL,
  iteration   integer NOT NULL,
  -- initial: what people think it is (not a conclusion). verified: confirmed by a manager with evidence.
  stage       text NOT NULL CHECK (stage IN ('initial','verified')),
  categories  text[] NOT NULL CHECK (categories <@ ARRAY['knowledge','equipment','resource','process']::text[]),
  notes       text NOT NULL,
  -- Copied from the old free-text root cause step; has no categories.
  migrated    boolean NOT NULL DEFAULT false,
  done_by     uuid NOT NULL REFERENCES users(id),
  done_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, ncr_id) REFERENCES nonconformities(company_id, id),
  CHECK (migrated OR cardinality(categories) >= 1)
);
CREATE INDEX ncr_cause_assessments_ncr ON ncr_cause_assessments (ncr_id, stage, done_at);

-- ─── Actions: correction / corrective action / follow-up, each with owner and due date ───
CREATE TABLE ncr_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  ncr_id        uuid NOT NULL,
  iteration     integer NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('correction','corrective_action','follow_up')),
  description   text NOT NULL,
  owner_id      uuid REFERENCES users(id),
  due_at        timestamptz,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  result_notes  text,
  done_by       uuid REFERENCES users(id),
  done_at       timestamptz,
  -- Where a support suggestion led (e.g. a service request the user created themselves).
  support_ref   jsonb,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, ncr_id) REFERENCES nonconformities(company_id, id),
  CHECK ((status = 'done') = (done_at IS NOT NULL AND done_by IS NOT NULL))
);
CREATE INDEX ncr_actions_ncr ON ncr_actions (ncr_id, iteration);
CREATE INDEX ncr_actions_owner ON ncr_actions (company_id, owner_id, status);

-- ─── Verification results (effective / not effective) and reopenings ───────────
CREATE TABLE ncr_verifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  ncr_id       uuid NOT NULL,
  iteration    integer NOT NULL,
  result       text NOT NULL CHECK (result IN ('effective','not_effective','reopened')),
  notes        text NOT NULL,
  verified_by  uuid NOT NULL REFERENCES users(id),
  verified_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, ncr_id) REFERENCES nonconformities(company_id, id)
);
CREATE INDEX ncr_verifications_ncr ON ncr_verifications (ncr_id, verified_at);

-- Old step records → new structures (old rows stay untouched in ncr_steps).
INSERT INTO ncr_actions (company_id, ncr_id, iteration, kind, description, owner_id, status, result_notes, done_by, done_at, created_by, created_at)
SELECT company_id, ncr_id, 1, step, notes, done_by, 'done', notes, done_by, done_at, done_by, done_at
  FROM ncr_steps WHERE step IN ('correction','corrective_action');
INSERT INTO ncr_cause_assessments (company_id, ncr_id, iteration, stage, categories, notes, migrated, done_by, done_at)
SELECT s.company_id, s.ncr_id, 1, st.stage, '{}', s.notes, true, s.done_by, s.done_at
  FROM ncr_steps s CROSS JOIN (VALUES ('initial'), ('verified')) AS st(stage) WHERE s.step = 'root_cause';
INSERT INTO ncr_verifications (company_id, ncr_id, iteration, result, notes, verified_by, verified_at)
SELECT company_id, id, 1, 'effective', 'Önceki sürümde doğrulanıp kapatıldı.', closed_by, closed_at
  FROM nonconformities WHERE status = 'closed' AND closed_by IS NOT NULL;

-- ─── In-app notifications ───────────────────────────────────────────────────────
CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  site_id      uuid,
  user_id      uuid NOT NULL REFERENCES users(id),
  kind         text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  title        text NOT NULL,
  body         text NOT NULL,
  -- Same key for the same recipient = the same notification; it is never created twice.
  dedupe_key   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at      timestamptz,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_inbox ON notifications (user_id, company_id, created_at DESC);

-- ─── "Does not apply" on a mandatory obligation: a request that someone else reviews ───
CREATE TABLE obligation_override_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  site_id         uuid NOT NULL,
  obligation_id   uuid NOT NULL REFERENCES obligations(id),
  reason          text NOT NULL,
  requested_by    uuid NOT NULL REFERENCES users(id),
  requested_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  reviewed_by     uuid REFERENCES users(id),
  reviewed_at     timestamptz,
  review_notes    text,
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id),
  CHECK (status = 'pending' OR status = 'withdrawn' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(review_notes) >= 5)),
  CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by)
);
CREATE UNIQUE INDEX obligation_override_one_pending ON obligation_override_requests (obligation_id) WHERE status = 'pending';

-- ─── Why a task was cancelled (so a reactivated unit gets its own checks back) ───
ALTER TABLE tasks ADD COLUMN cancel_code text CHECK (cancel_code IN ('equipment_retired','obligation_changed','override'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ncr_cause_assessments','ncr_actions','ncr_verifications','notifications','obligation_override_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id))', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON ncr_cause_assessments, ncr_verifications TO goverhub_app;
GRANT SELECT, INSERT, UPDATE ON ncr_actions, notifications, obligation_override_requests TO goverhub_app;

-- Demo reset (admin action, demo deployments only) also clears the rows added in 006 and 007
-- for demo companies. Real (non-demo) companies are never touched.
CREATE OR REPLACE FUNCTION demo_reset() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('app.demo_reset', 'on', true);
  PERFORM set_config('app.system', 'on', true);
  DELETE FROM notifications WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM obligation_override_requests WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM task_assignment_defaults WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM service_jobs WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM quotes WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM service_requests WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  ALTER TABLE evidence DISABLE TRIGGER evidence_guard;
  DELETE FROM evidence WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  ALTER TABLE evidence ENABLE TRIGGER evidence_guard;
  DELETE FROM ncr_verifications WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM ncr_actions WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM ncr_cause_assessments WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM ncr_steps WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM nonconformities WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM measurements WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM tasks WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM obligations WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM equipment WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM profile_facts WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM client_operations WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM access_grants WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM audit_events WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM memberships WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM site_closures WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM sites WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM companies WHERE is_demo;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
