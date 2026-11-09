-- Delivery 6A: from a case's cause to a lasting fix.
--  * A suggestion may be set aside (or brought back) with a reason; the decision is kept per round.
--  * An effectiveness check may carry a new measurement, compared with the limits of the original finding.

CREATE TABLE ncr_suggestion_decisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  ncr_id         uuid NOT NULL,
  iteration      integer NOT NULL,
  suggestion_key text NOT NULL CHECK (suggestion_key ~ '^[a-z_]+:[a-z_]+$'),
  decision       text NOT NULL CHECK (decision IN ('dismissed','restored')),
  reason         text NOT NULL CHECK (length(reason) >= 10),
  replacement    text,
  decided_by     uuid NOT NULL REFERENCES users(id),
  decided_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, ncr_id) REFERENCES nonconformities(company_id, id)
);
CREATE INDEX ncr_suggestion_decisions_ncr ON ncr_suggestion_decisions (ncr_id, suggestion_key, decided_at);
ALTER TABLE ncr_suggestion_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON ncr_suggestion_decisions USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id));
GRANT SELECT, INSERT ON ncr_suggestion_decisions TO goverhub_app;

-- New measurement recorded with an effectiveness check: { value, unit, limitMin, limitMax, within, basis }.
ALTER TABLE ncr_steps ADD COLUMN data jsonb;

CREATE OR REPLACE FUNCTION demo_reset_6a() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.system', 'on', true);
  DELETE FROM ncr_suggestion_decisions WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
END $$;
ALTER FUNCTION demo_reset() RENAME TO demo_reset_before_6a;
CREATE FUNCTION demo_reset() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM demo_reset_6a();
  RETURN demo_reset_before_6a();
END $$;
