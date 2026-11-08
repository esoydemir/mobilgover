-- Verification by risk, external verifiers, separate roles on actions, issuer checks on documents,
-- controlled site reading of company-wide documents. Additive: no existing row is changed or removed.

-- ─── Actions: who did the work is kept apart from who pressed "done" and who verified ───
-- performed_by: the person who did the work (may differ from done_by, who declared it in the app).
ALTER TABLE ncr_actions ADD COLUMN performed_by uuid REFERENCES users(id);
-- How the claim was verified: by someone with no part in it, or by a contributor (self, low risk only).
ALTER TABLE ncr_actions ADD COLUMN verification_mode text CHECK (verification_mode IN ('independent','self'));
-- Through a membership of the business or an outside verifier's limited grant.
ALTER TABLE ncr_actions ADD COLUMN verified_via text CHECK (verified_via IN ('membership','grant'));

ALTER TABLE ncr_verifications ADD COLUMN verification_mode text CHECK (verification_mode IN ('independent','self'));
ALTER TABLE ncr_verifications ADD COLUMN verified_via text CHECK (verified_via IN ('membership','grant'));

-- ─── Outside verifier: a grant may be limited to one site ───
ALTER TABLE access_grants ADD COLUMN site_id uuid REFERENCES sites(id);

-- ─── Documents: a check with the issuing authority is recorded apart from the internal review ───
ALTER TABLE document_versions ADD COLUMN issuer_check_method text
  CHECK (issuer_check_method IN ('barcode_query','issuer_portal','issuer_written_confirmation','other'));
ALTER TABLE document_versions ADD COLUMN issuer_check_ref text;
ALTER TABLE document_versions ADD COLUMN issuer_check_notes text;
ALTER TABLE document_versions ADD COLUMN issuer_checked_by uuid REFERENCES users(id);
ALTER TABLE document_versions ADD COLUMN issuer_checked_at timestamptz;
ALTER TABLE document_versions ADD CONSTRAINT document_versions_issuer_check_complete CHECK (
  issuer_check_method IS NULL OR (review_status = 'verified' AND issuer_checked_by IS NOT NULL AND issuer_checked_at IS NOT NULL
    AND length(issuer_check_ref) >= 3));

-- Company-wide documents a site may read (not change or review). Revoking keeps the row.
CREATE TABLE document_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  document_id uuid NOT NULL,
  site_id     uuid NOT NULL,
  granted_by  uuid NOT NULL REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_by  uuid REFERENCES users(id),
  revoked_at  timestamptz,
  FOREIGN KEY (company_id, document_id) REFERENCES documents(company_id, id),
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id)
);
CREATE UNIQUE INDEX document_shares_live ON document_shares (document_id, site_id) WHERE revoked_at IS NULL;
ALTER TABLE document_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON document_shares USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id));
GRANT SELECT, INSERT, UPDATE ON document_shares TO goverhub_app;

-- Provider-side notifications carry the business's company id (for isolation) but are read by the
-- provider through their own inbox; the business name is never in them before a quote is accepted.
CREATE INDEX IF NOT EXISTS notifications_user_created ON notifications (user_id, created_at DESC);

-- Demo reset also clears the new table.
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
  DELETE FROM document_shares WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
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
