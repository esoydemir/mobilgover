-- Delivery 6C: from the network to the right specialist and a tracked result.

-- Quotes say what will be handed over (report, measurement record, certificate …).
ALTER TABLE quotes ADD COLUMN deliverable text NOT NULL DEFAULT '';

-- Jobs: the business may ask for a revision (with a reason) instead of accepting, and may cancel
-- before acceptance. "disputed" stays for older rows.
ALTER TABLE service_jobs DROP CONSTRAINT IF EXISTS service_jobs_status_check;
ALTER TABLE service_jobs ADD CONSTRAINT service_jobs_status_check
  CHECK (status IN ('scheduled','checked_in','report_submitted','revision_requested','accepted','disputed','cancelled'));
ALTER TABLE service_jobs ADD COLUMN cancelled_by uuid REFERENCES users(id), ADD COLUMN cancelled_at timestamptz, ADD COLUMN cancel_reason text;
ALTER TABLE service_requests ADD COLUMN cancelled_by uuid REFERENCES users(id), ADD COLUMN cancelled_at timestamptz, ADD COLUMN cancel_reason text;

-- Every report version and every business decision on it is kept.
CREATE TABLE service_job_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  job_id       uuid NOT NULL REFERENCES service_jobs(id),
  version      integer NOT NULL,
  report       text NOT NULL,
  submitted_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decision     text CHECK (decision IN ('accepted','revision_requested')),
  decision_note text,
  decided_by   uuid REFERENCES users(id),
  decided_at   timestamptz,
  UNIQUE (job_id, version)
);
ALTER TABLE service_job_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON service_job_reports USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id));
GRANT SELECT, INSERT, UPDATE ON service_job_reports TO goverhub_app;
-- Existing reports become version 1.
INSERT INTO service_job_reports (company_id, job_id, version, report, submitted_by, submitted_at, decision, decision_note, decided_by, decided_at)
  SELECT j.company_id, j.id, 1, j.report, pp.user_id, j.report_submitted_at,
         CASE WHEN j.status = 'accepted' THEN 'accepted' WHEN j.status = 'disputed' THEN 'revision_requested' END,
         j.business_note, j.accepted_by, j.accepted_at
    FROM service_jobs j JOIN professional_profiles pp ON pp.id = j.provider_profile_id WHERE j.report IS NOT NULL;

-- Case shares: the permission is for one exact content (hash of summary + snapshot). A change after
-- that needs a new permission before it can be published again. An authorised person of the business
-- can withdraw it; it is then closed to the network.
ALTER TABLE network_posts DROP CONSTRAINT IF EXISTS network_posts_status_check;
ALTER TABLE network_posts ADD CONSTRAINT network_posts_status_check CHECK (status IN ('draft','published','deleted','withdrawn'));
ALTER TABLE network_posts ADD COLUMN case_content_hash text, ADD COLUMN case_reapproval_needed boolean NOT NULL DEFAULT false,
  ADD COLUMN withdrawn_by uuid REFERENCES users(id), ADD COLUMN withdrawn_at timestamptz, ADD COLUMN withdraw_reason text;

-- Appeals: the person whose content was acted on asks for a second look. Never the first moderator.
CREATE TABLE network_appeals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES network_reports(id),
  appellant_id uuid NOT NULL REFERENCES users(id),
  reason      text NOT NULL CHECK (length(reason) >= 10),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','overturned')),
  decision_notes text,
  handled_by  uuid REFERENCES users(id),
  handled_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (status = 'open' OR (handled_by IS NOT NULL AND length(decision_notes) >= 10))
);
CREATE UNIQUE INDEX network_appeals_once ON network_appeals (report_id);
GRANT SELECT, INSERT, UPDATE ON network_appeals TO goverhub_app;

-- Repeated submissions outside a business (network, provider side) answer once.
CREATE TABLE user_operations (
  user_id      uuid NOT NULL REFERENCES users(id),
  op_key       text NOT NULL,
  request_hash text NOT NULL,
  status_code  integer NOT NULL,
  response     jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, op_key)
);
GRANT SELECT, INSERT ON user_operations TO goverhub_app;

-- Demo reset: case posts of demo businesses (and what hangs on them) go with the business.
CREATE OR REPLACE FUNCTION demo_reset_6c() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.system', 'on', true);
  DELETE FROM service_job_reports WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM network_appeals WHERE report_id IN (SELECT r.id FROM network_reports r JOIN network_posts p ON p.id = r.target_id
     WHERE r.target_type = 'post' AND p.case_company_id IN (SELECT id FROM companies WHERE is_demo));
  DELETE FROM network_reports WHERE target_type = 'post' AND target_id IN (SELECT id FROM network_posts WHERE case_company_id IN (SELECT id FROM companies WHERE is_demo));
  DELETE FROM network_reports WHERE target_type = 'comment' AND target_id IN (SELECT c.id FROM network_comments c JOIN network_posts p ON p.id = c.post_id
     WHERE p.case_company_id IN (SELECT id FROM companies WHERE is_demo));
  DELETE FROM network_comments WHERE post_id IN (SELECT id FROM network_posts WHERE case_company_id IN (SELECT id FROM companies WHERE is_demo));
  DELETE FROM network_posts WHERE case_company_id IN (SELECT id FROM companies WHERE is_demo);
END $$;
ALTER FUNCTION demo_reset() RENAME TO demo_reset_before_6c;
CREATE FUNCTION demo_reset() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM demo_reset_6c();
  RETURN demo_reset_before_6c();
END $$;
