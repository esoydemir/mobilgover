-- GH-07 correction: a wrong product decision is corrected, never overwritten. The earlier decision, who gave it and when, stays here;
-- the assessment row always shows the current decision. A correction on a closed case reopens it (the earlier closure stays in its history).
CREATE TABLE ncr_product_decision_revisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  ncr_id            uuid NOT NULL,
  assessment_id     uuid NOT NULL REFERENCES ncr_product_assessments(id),
  prev_decision     text NOT NULL,
  prev_rationale    text NOT NULL,
  prev_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  prev_decided_by   uuid NOT NULL REFERENCES users(id),
  prev_decided_at   timestamptz NOT NULL,
  new_decision      text NOT NULL,
  new_rationale     text NOT NULL,
  reason            text NOT NULL CHECK (length(btrim(reason)) >= 20),
  corrected_by      uuid NOT NULL REFERENCES users(id),
  corrected_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  case_was_closed   boolean NOT NULL,
  FOREIGN KEY (company_id, ncr_id) REFERENCES nonconformities(company_id, id)
);
CREATE INDEX ncr_product_decision_revisions_a ON ncr_product_decision_revisions (assessment_id, corrected_at);
ALTER TABLE ncr_product_decision_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON ncr_product_decision_revisions USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id));
GRANT SELECT, INSERT ON ncr_product_decision_revisions TO goverhub_app;

CREATE OR REPLACE FUNCTION demo_reset_gh07b() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.system', 'on', true);
  DELETE FROM ncr_product_decision_revisions WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
END $$;
ALTER FUNCTION demo_reset() RENAME TO demo_reset_before_gh07b;
CREATE FUNCTION demo_reset() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM demo_reset_gh07b();
  RETURN demo_reset_before_gh07b();
END $$;
GRANT EXECUTE ON FUNCTION demo_reset() TO goverhub_app;
REVOKE ALL ON FUNCTION demo_reset() FROM PUBLIC;
