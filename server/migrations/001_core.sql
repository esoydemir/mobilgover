-- GoverHub core schema, first vertical slice.
-- Owned by the migration role; the runtime role gets only the grants at the end,
-- so row-level security applies to it.

-- ─── Tenancy and identity ───────────────────────────────────────────────────

CREATE TABLE companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  -- Demo companies are the only ones demo_reset() may delete.
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  name          text NOT NULL,
  timezone      text NOT NULL DEFAULT 'Europe/Istanbul',
  -- ISO weekdays the site operates (1 = Monday … 7 = Sunday).
  opening_days  smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);

CREATE TABLE site_closures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  site_id     uuid NOT NULL,
  day         date NOT NULL,
  reason      text NOT NULL,
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id),
  UNIQUE (site_id, day)
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL,
  email         text UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Only a hash of the bearer token is stored.
CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  company_id  uuid NOT NULL REFERENCES companies(id),
  -- NULL = company-wide; otherwise the role is limited to this site.
  site_id     uuid,
  role        text NOT NULL CHECK (role IN ('owner','hq_manager','site_manager','staff')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id),
  UNIQUE NULLS NOT DISTINCT (user_id, company_id, site_id)
);

-- Time-limited access for outside parties (experts, service providers, platform support).
CREATE TABLE access_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  kind        text NOT NULL CHECK (kind IN ('expert','service_provider','platform_support')),
  -- Data types the grant covers, e.g. {profile,obligations,nonconformities}.
  scopes      text[] NOT NULL,
  granted_by  uuid NOT NULL REFERENCES users(id),
  reason      text NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_roles (
  user_id  uuid NOT NULL REFERENCES users(id),
  role     text NOT NULL CHECK (role IN ('rule_author','rule_reviewer','platform_admin')),
  PRIMARY KEY (user_id, role)
);

-- ─── Business profile (append-only facts) ───────────────────────────────────
-- The current value of a fact is its latest row. Rows are never updated, so a
-- past decision can always be explained with the facts it actually saw.

CREATE TABLE profile_facts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  site_id       uuid,
  key           text NOT NULL,
  -- NULL value with verification 'rejected' withdraws a fact (back to unknown).
  value         jsonb,
  source        text NOT NULL CHECK (source IN ('user_declared','ocr','expert','system')),
  verification  text NOT NULL CHECK (verification IN ('unverified','user_confirmed','expert_verified','rejected')),
  source_ref    text,
  confidence    numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  valid_from    date,
  valid_to      date,
  note          text,
  recorded_by   uuid REFERENCES users(id),
  recorded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE INDEX profile_facts_current ON profile_facts (company_id, key, recorded_at DESC);

-- ─── Regulation and rules (platform-wide) ───────────────────────────────────

CREATE TABLE legal_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  title       text NOT NULL,
  issuer      text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('law','regulation','communique','standard','guidance')),
  url         text,
  -- Example sources are illustrative and must never back a production rule.
  is_example  boolean NOT NULL DEFAULT false
);

CREATE TABLE source_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       uuid NOT NULL REFERENCES legal_sources(id),
  version_label   text NOT NULL,
  published_on    date,
  effective_from  date,
  effective_to    date,
  retrieved_at    timestamptz NOT NULL DEFAULT now(),
  content_sha256  text,
  UNIQUE (source_id, version_label)
);

CREATE TABLE provisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_version_id  uuid NOT NULL REFERENCES source_versions(id),
  ref                text NOT NULL,
  excerpt            text NOT NULL,
  UNIQUE (source_version_id, ref)
);

CREATE TABLE interpretations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provision_id  uuid NOT NULL REFERENCES provisions(id),
  summary       text NOT NULL,
  author_id     uuid NOT NULL REFERENCES users(id),
  reviewed_by   uuid REFERENCES users(id),
  reviewed_at   timestamptz,
  CHECK (reviewed_by IS NULL OR reviewed_by <> author_id)
);

CREATE TABLE rules (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code   text NOT NULL UNIQUE,
  title  text NOT NULL
);

CREATE TABLE rule_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id            uuid NOT NULL REFERENCES rules(id),
  version            integer NOT NULL CHECK (version > 0),
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','in_review','approved','published','retired')),
  -- A legal requirement and a recommended good practice are never mixed.
  kind               text NOT NULL CHECK (kind IN ('legal_requirement','good_practice')),
  is_example         boolean NOT NULL DEFAULT false,
  provision_ids      uuid[] NOT NULL DEFAULT '{}',
  interpretation_id  uuid REFERENCES interpretations(id),
  scope              jsonb NOT NULL DEFAULT '{}',
  condition          jsonb NOT NULL,
  required_facts     text[] NOT NULL,
  -- Set when the provision is ambiguous: matches go to human review instead of "applies".
  ambiguity_note     text,
  obligation_title   text NOT NULL,
  obligation_summary text NOT NULL,
  effective_from     date NOT NULL,
  effective_to       date,
  change_reason      text NOT NULL,
  author_id          uuid NOT NULL REFERENCES users(id),
  reviewer_id        uuid REFERENCES users(id),
  reviewed_at        timestamptz,
  published_by       uuid REFERENCES users(id),
  published_at       timestamptz,
  retired_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, version),
  CHECK (reviewer_id IS NULL OR reviewer_id <> author_id),
  CHECK (kind = 'good_practice' OR is_example OR cardinality(provision_ids) > 0),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX rule_versions_one_published ON rule_versions (rule_id) WHERE status = 'published';

CREATE TABLE task_templates (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_version_id         uuid NOT NULL REFERENCES rule_versions(id),
  code                    text NOT NULL,
  title                   text NOT NULL,
  instructions            text NOT NULL,
  recurrence              jsonb NOT NULL,
  evidence                jsonb NOT NULL,
  limits                  jsonb NOT NULL DEFAULT '[]',
  severity                text NOT NULL CHECK (severity IN ('minor','major','critical')),
  hazard_type             text NOT NULL,
  emergency_instruction   text,
  emergency_approved_by   uuid REFERENCES users(id),
  UNIQUE (rule_version_id, code)
);

-- Content of a version is frozen once it leaves draft; only the status moves.
CREATE FUNCTION rule_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.condition IS DISTINCT FROM OLD.condition OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.provision_ids IS DISTINCT FROM OLD.provision_ids OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.obligation_title IS DISTINCT FROM OLD.obligation_title
    OR NEW.required_facts IS DISTINCT FROM OLD.required_facts OR NEW.ambiguity_note IS DISTINCT FROM OLD.ambiguity_note) THEN
    RAISE EXCEPTION 'rule version % is % and its content cannot change', OLD.id, OLD.status;
  END IF;
  IF NOT (
       (OLD.status = NEW.status)
    OR (OLD.status = 'draft' AND NEW.status = 'in_review')
    OR (OLD.status = 'in_review' AND NEW.status IN ('draft','approved'))
    OR (OLD.status = 'approved' AND NEW.status = 'published')
    OR (OLD.status = 'published' AND NEW.status = 'retired')) THEN
    RAISE EXCEPTION 'invalid rule status change % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rule_version_guard BEFORE UPDATE ON rule_versions FOR EACH ROW EXECUTE FUNCTION rule_version_guard();

-- Templates are editable while the rule is a draft. During review the only
-- permitted change is the reviewer approving the emergency instruction.
CREATE FUNCTION task_template_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM rule_versions WHERE id = COALESCE(NEW.rule_version_id, OLD.rule_version_id);
  IF st = 'draft' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF st = 'in_review' AND TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'emergency_approved_by') = (to_jsonb(OLD) - 'emergency_approved_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'task templates of a % rule version are frozen', st;
END $$;
CREATE TRIGGER task_template_guard BEFORE INSERT OR UPDATE OR DELETE ON task_templates FOR EACH ROW EXECUTE FUNCTION task_template_guard();

-- ─── Obligations (append-only decisions) ────────────────────────────────────

CREATE TABLE obligations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  site_id          uuid NOT NULL,
  rule_id          uuid NOT NULL REFERENCES rules(id),
  rule_version_id  uuid NOT NULL REFERENCES rule_versions(id),
  decision         text NOT NULL CHECK (decision IN ('applies','not_applicable','needs_info','needs_review')),
  -- 'engine' or the id of the person who made a manual decision.
  decided_by       text NOT NULL,
  reason           text,
  trace            jsonb NOT NULL,
  facts_snapshot   jsonb NOT NULL,
  missing_facts    text[] NOT NULL DEFAULT '{}',
  decided_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id),
  -- A manual "does not apply" must say why.
  CHECK (decided_by = 'engine' OR reason IS NOT NULL)
);
CREATE INDEX obligations_current ON obligations (company_id, site_id, rule_id, decided_at DESC);

-- ─── Equipment ──────────────────────────────────────────────────────────────

CREATE TABLE equipment (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  site_id           uuid NOT NULL,
  type              text NOT NULL,
  name              text NOT NULL,
  serial            text,
  -- For measuring instruments: calibration valid until.
  calibrated_until  date,
  active            boolean NOT NULL DEFAULT true,
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id),
  UNIQUE (company_id, id)
);

-- ─── Tasks, measurements, evidence ──────────────────────────────────────────

CREATE TABLE tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  site_id        uuid NOT NULL,
  obligation_id  uuid NOT NULL REFERENCES obligations(id),
  template_id    uuid NOT NULL REFERENCES task_templates(id),
  -- Rule and template code are stable across rule versions; they make generation idempotent.
  rule_id        uuid NOT NULL REFERENCES rules(id),
  template_code  text NOT NULL,
  equipment_id   uuid,
  period_key     text NOT NULL,
  due_at         timestamptz NOT NULL,
  assignee_id    uuid REFERENCES users(id),
  -- "Was the check done" (status) is separate from "was the result OK" (outcome).
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','missed','cancelled')),
  outcome        text CHECK (outcome IN ('conforming','nonconforming')),
  review_flag    text,
  status_reason  text,
  completed_by   uuid REFERENCES users(id),
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id),
  FOREIGN KEY (company_id, equipment_id) REFERENCES equipment(company_id, id),
  UNIQUE (company_id, id),
  CHECK ((status = 'done') = (outcome IS NOT NULL)),
  CHECK (status <> 'done' OR (completed_by IS NOT NULL AND completed_at IS NOT NULL))
);
-- One task per rule, template code, site, equipment and period: re-running generation,
-- or publishing a new rule version, never creates a second task for the same check.
CREATE UNIQUE INDEX tasks_idempotent ON tasks
  (company_id, site_id, rule_id, template_code, COALESCE(equipment_id, '00000000-0000-0000-0000-000000000000'::uuid), period_key)
  WHERE status <> 'cancelled';
CREATE INDEX tasks_due ON tasks (company_id, status, due_at);

CREATE TABLE measurements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  task_id             uuid NOT NULL,
  quantity            text NOT NULL,
  value               numeric NOT NULL,
  unit                text NOT NULL,
  -- Device time (when measured) and server time (when received) are kept apart.
  measured_at         timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  instrument_id       uuid,
  calibration_status  text NOT NULL CHECK (calibration_status IN ('valid','expired','unknown')),
  limit_min           numeric,
  limit_max           numeric,
  limit_source        jsonb NOT NULL,
  within_limit        boolean NOT NULL,
  recorded_by         uuid NOT NULL REFERENCES users(id),
  FOREIGN KEY (company_id, task_id) REFERENCES tasks(company_id, id),
  FOREIGN KEY (company_id, instrument_id) REFERENCES equipment(company_id, id)
);

CREATE TABLE evidence (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  task_id          uuid,
  ncr_id           uuid,
  kind             text NOT NULL CHECK (kind IN ('photo','document','note','checklist','approval','device_record')),
  -- A file is only evidence once its bytes arrived and matched the declared hash.
  status           text NOT NULL CHECK (status IN ('pending_upload','stored','rejected')),
  mime             text,
  declared_sha256  text,
  sha256           text,
  size_bytes       bigint,
  storage_key      text,
  body             jsonb,
  rejection_reason text,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  stored_at        timestamptz,
  FOREIGN KEY (company_id, task_id) REFERENCES tasks(company_id, id),
  CHECK (task_id IS NOT NULL OR ncr_id IS NOT NULL),
  CHECK (status <> 'stored' OR kind IN ('note','checklist','approval') OR (sha256 IS NOT NULL AND storage_key IS NOT NULL))
);

-- Stored evidence is immutable; a correction is a new evidence row.
CREATE FUNCTION evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'evidence cannot be deleted';
  END IF;
  IF OLD.status <> 'pending_upload' THEN
    RAISE EXCEPTION 'evidence % is % and cannot change', OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER evidence_guard BEFORE UPDATE OR DELETE ON evidence FOR EACH ROW EXECUTE FUNCTION evidence_guard();

-- ─── Nonconformities and CAPA ───────────────────────────────────────────────

CREATE TABLE nonconformities (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id),
  site_id                uuid NOT NULL,
  task_id                uuid,
  measurement_id         uuid REFERENCES measurements(id),
  equipment_id           uuid,
  hazard_type            text NOT NULL,
  title                  text NOT NULL,
  description            text NOT NULL,
  risk_level             text NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  risk_rationale         jsonb NOT NULL,
  recurrence_count       integer NOT NULL DEFAULT 0,
  -- Depth follows risk: small deviations get a correction, serious or repeated ones a full CAPA.
  depth                  text NOT NULL CHECK (depth IN ('correction','capa')),
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','awaiting_verification','closed')),
  emergency_instruction  text,
  owner_id               uuid REFERENCES users(id),
  due_at                 timestamptz,
  detected_by            uuid NOT NULL REFERENCES users(id),
  detected_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_by              uuid REFERENCES users(id),
  closed_at              timestamptz,
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id),
  FOREIGN KEY (company_id, task_id) REFERENCES tasks(company_id, id),
  FOREIGN KEY (company_id, equipment_id) REFERENCES equipment(company_id, id),
  UNIQUE (company_id, id),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX nonconformities_one_per_task ON nonconformities (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX nonconformities_recurrence ON nonconformities (company_id, equipment_id, hazard_type, detected_at);

ALTER TABLE evidence ADD FOREIGN KEY (company_id, ncr_id) REFERENCES nonconformities(company_id, id);

CREATE TABLE ncr_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  ncr_id       uuid NOT NULL,
  step         text NOT NULL CHECK (step IN ('containment','correction','root_cause','corrective_action','effectiveness_check')),
  notes        text NOT NULL,
  done_by      uuid NOT NULL REFERENCES users(id),
  done_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, ncr_id) REFERENCES nonconformities(company_id, id),
  UNIQUE (ncr_id, step)
);

-- ─── Audit trail ────────────────────────────────────────────────────────────

CREATE TABLE audit_events (
  id           bigserial PRIMARY KEY,
  company_id   uuid REFERENCES companies(id),
  seq          bigint NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  client_time  timestamptz,
  actor_id     uuid REFERENCES users(id),
  event_type   text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  payload      jsonb NOT NULL,
  prev_hash    text NOT NULL,
  hash         text NOT NULL,
  UNIQUE NULLS NOT DISTINCT (company_id, seq)
);

CREATE FUNCTION audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The only permitted removal is demo_reset() on a demo company.
  IF TG_OP = 'DELETE' AND current_setting('app.demo_reset', true) = 'on'
     AND (SELECT is_demo FROM companies WHERE id = OLD.company_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit events are append-only';
END $$;
CREATE TRIGGER audit_guard BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_guard();

-- Offline clients resend operations; the first result is replayed for the same key.
CREATE TABLE client_operations (
  company_id    uuid NOT NULL REFERENCES companies(id),
  op_key        text NOT NULL,
  user_id       uuid NOT NULL REFERENCES users(id),
  request_hash  text NOT NULL,
  status_code   integer NOT NULL,
  response      jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, op_key)
);

-- ─── Row-level security ─────────────────────────────────────────────────────
-- Second line of defence after the service-layer checks: a request transaction
-- sets app.company_id and can only ever see that company's rows.

CREATE FUNCTION app_tenant_ok(cid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.system', true) = 'on'
      OR cid::text = current_setting('app.company_id', true)
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sites','site_closures','profile_facts','obligations','equipment','tasks',
                           'measurements','evidence','nonconformities','ncr_steps','client_operations','access_grants']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id))', t);
  END LOOP;
END $$;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON companies USING (app_tenant_ok(id)) WITH CHECK (app_tenant_ok(id));
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON audit_events
  USING (current_setting('app.system', true) = 'on' OR (company_id IS NOT NULL AND app_tenant_ok(company_id)))
  WITH CHECK (current_setting('app.system', true) = 'on' OR (company_id IS NOT NULL AND app_tenant_ok(company_id)));

-- ─── Demo reset ─────────────────────────────────────────────────────────────

CREATE FUNCTION demo_reset() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('app.demo_reset', 'on', true);
  PERFORM set_config('app.system', 'on', true);
  -- Rows hang off companies; delete children first, demo companies only.
  ALTER TABLE evidence DISABLE TRIGGER evidence_guard;
  DELETE FROM evidence WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  ALTER TABLE evidence ENABLE TRIGGER evidence_guard;
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
REVOKE ALL ON FUNCTION demo_reset() FROM PUBLIC;

-- ─── Runtime role grants ────────────────────────────────────────────────────
-- No UPDATE/DELETE on append-only tables; triggers enforce the rest.

GRANT USAGE ON SCHEMA public TO goverhub_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO goverhub_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO goverhub_app;
GRANT UPDATE ON companies, sites, equipment, tasks, evidence, nonconformities, rule_versions, task_templates, access_grants TO goverhub_app;
GRANT DELETE ON sessions TO goverhub_app;
GRANT EXECUTE ON FUNCTION demo_reset() TO goverhub_app;
