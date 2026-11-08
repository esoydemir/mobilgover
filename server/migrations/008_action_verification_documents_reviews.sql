-- Action verification, fact-based review of "does not apply", document vault, service reviews.
-- Additive: no existing row is removed.

-- ─── Actions: a "done" is a claim until its evidence is in and someone else verifies it ───
ALTER TABLE ncr_actions ADD COLUMN evidence_required text NOT NULL DEFAULT 'none'
  CHECK (evidence_required IN ('none','photo','document'));
ALTER TABLE ncr_actions ADD COLUMN verification_status text NOT NULL DEFAULT 'not_declared'
  CHECK (verification_status IN ('not_declared','declared','verified','rejected','legacy'));
ALTER TABLE ncr_actions ADD COLUMN verified_by uuid REFERENCES users(id);
ALTER TABLE ncr_actions ADD COLUMN verified_at timestamptz;
ALTER TABLE ncr_actions ADD COLUMN verification_notes text;
-- Earlier completions: before the flow existed (v1) they stand as they were recorded ("legacy");
-- completions made under the v2 flow become claims that still need verification.
UPDATE ncr_actions a SET verification_status = CASE WHEN n.flow_version = 1 THEN 'legacy' ELSE 'declared' END
  FROM nonconformities n WHERE n.id = a.ncr_id AND a.status = 'done';
ALTER TABLE ncr_actions ADD CONSTRAINT ncr_actions_verified_has_verifier
  CHECK (verification_status <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL));

-- Evidence can now belong to an action or a document version as well.
ALTER TABLE evidence ADD COLUMN action_id uuid REFERENCES ncr_actions(id);
ALTER TABLE evidence ADD COLUMN document_version_id uuid;
ALTER TABLE evidence DROP CONSTRAINT evidence_check;
ALTER TABLE evidence ADD CONSTRAINT evidence_has_owner CHECK (task_id IS NOT NULL OR ncr_id IS NOT NULL OR document_version_id IS NOT NULL);

-- ─── "Does not apply" on a mandatory obligation: which facts are disputed, and on what basis ───
ALTER TABLE obligation_override_requests ADD COLUMN disputed_facts jsonb;
ALTER TABLE obligation_override_requests ADD COLUMN basis text;
-- What the rule engine decided after the reviewed facts were recorded.
ALTER TABLE obligation_override_requests ADD COLUMN engine_outcome text;

-- ─── Document vault ─────────────────────────────────────────────────────────────
CREATE TABLE documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  -- NULL site = company-wide document.
  site_id      uuid,
  equipment_id uuid,
  doc_type     text NOT NULL CHECK (doc_type IN ('business_license','food_registration','calibration_certificate','maintenance_report',
                  'training_certificate','health_certificate','insurance','contract','other')),
  title        text NOT NULL,
  issuer       text,
  document_no  text,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  archived_at  timestamptz,
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id),
  FOREIGN KEY (company_id, equipment_id) REFERENCES equipment(company_id, id),
  UNIQUE (company_id, id)
);

CREATE TABLE document_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  document_id    uuid NOT NULL,
  version        integer NOT NULL,
  valid_from     date,
  valid_until    date,
  notes          text,
  -- An uploaded file is not a verified or valid document until a person other than the uploader reviews it.
  review_status  text NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed','verified','rejected')),
  reviewed_by    uuid REFERENCES users(id),
  reviewed_at    timestamptz,
  review_notes   text,
  uploaded_by    uuid NOT NULL REFERENCES users(id),
  uploaded_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, document_id) REFERENCES documents(company_id, id),
  UNIQUE (document_id, version),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  CHECK (review_status = 'unreviewed' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(review_notes) >= 5)),
  CHECK (reviewed_by IS NULL OR reviewed_by <> uploaded_by)
);
ALTER TABLE evidence ADD CONSTRAINT evidence_document_version_fk FOREIGN KEY (document_version_id) REFERENCES document_versions(id);

-- ─── Service reviews: only for delivered and accepted jobs; one per job ───────────
CREATE TABLE service_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  job_id              uuid NOT NULL UNIQUE REFERENCES service_jobs(id),
  provider_profile_id uuid NOT NULL REFERENCES professional_profiles(id),
  quality             smallint NOT NULL CHECK (quality BETWEEN 1 AND 5),
  timeliness          smallint NOT NULL CHECK (timeliness BETWEEN 1 AND 5),
  communication       smallint NOT NULL CHECK (communication BETWEEN 1 AND 5),
  comment             text,
  -- The business decides whether this job may appear (without its name) on the provider's profile.
  show_on_profile     boolean NOT NULL DEFAULT false,
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documents','document_versions','service_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id))', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON documents, document_versions TO goverhub_app;
GRANT SELECT, INSERT ON service_reviews TO goverhub_app;

-- Demo reset also clears the new rows of demo companies.
CREATE OR REPLACE FUNCTION demo_reset() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('app.demo_reset', 'on', true);
  PERFORM set_config('app.system', 'on', true);
  DELETE FROM notifications WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM obligation_override_requests WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM task_assignment_defaults WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM service_reviews WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM service_jobs WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM quotes WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM service_requests WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  ALTER TABLE evidence DISABLE TRIGGER evidence_guard;
  DELETE FROM evidence WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  ALTER TABLE evidence ENABLE TRIGGER evidence_guard;
  DELETE FROM document_versions WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM documents WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
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
