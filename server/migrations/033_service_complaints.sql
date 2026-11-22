-- GH-06: a complaint about a service job, opened by either side. It is its own record: it never changes the job's
-- delivery status, the review of the report document, or the nonconformity. A platform reviewer resolves it with a written decision.
CREATE TABLE service_complaints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  job_id        uuid NOT NULL REFERENCES service_jobs(id),
  opened_side   text NOT NULL CHECK (opened_side IN ('business','provider')),
  opened_by     uuid NOT NULL REFERENCES users(id),
  reason        text NOT NULL CHECK (length(reason) >= 10),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','responded','resolved')),
  response      text,
  responded_by  uuid REFERENCES users(id),
  responded_at  timestamptz,
  resolution    text,
  resolved_by   uuid REFERENCES users(id),
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (status <> 'resolved' OR (resolution IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);
-- One open complaint per side per job: repeating it adds nothing.
CREATE UNIQUE INDEX service_complaints_one_open ON service_complaints (job_id, opened_side) WHERE status <> 'resolved';
CREATE INDEX service_complaints_status ON service_complaints (status, created_at);
ALTER TABLE service_complaints ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON service_complaints USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id));
GRANT SELECT, INSERT, UPDATE ON service_complaints TO goverhub_app;

CREATE OR REPLACE FUNCTION demo_reset_gh06() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.system', 'on', true);
  DELETE FROM service_complaints WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
END $$;
ALTER FUNCTION demo_reset() RENAME TO demo_reset_before_gh06;
CREATE FUNCTION demo_reset() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM demo_reset_gh06();
  RETURN demo_reset_before_gh06();
END $$;
GRANT EXECUTE ON FUNCTION demo_reset() TO goverhub_app;
REVOKE ALL ON FUNCTION demo_reset() FROM PUBLIC;
