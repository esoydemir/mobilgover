-- Delivery 6B: manager board, repeat candidates and more than one site.
-- A manager links two cases as the same problem seen again, or marks a suggested pair unrelated.
-- Nothing is merged and neither case changes; the latest decision for a pair is shown, earlier ones stay.

CREATE TABLE ncr_relations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  ncr_id         uuid NOT NULL,
  related_ncr_id uuid NOT NULL,
  decision       text NOT NULL CHECK (decision IN ('linked','unrelated')),
  reason         text NOT NULL CHECK (length(reason) >= 10),
  decided_by     uuid NOT NULL REFERENCES users(id),
  decided_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, ncr_id) REFERENCES nonconformities(company_id, id),
  FOREIGN KEY (company_id, related_ncr_id) REFERENCES nonconformities(company_id, id),
  CHECK (ncr_id <> related_ncr_id)
);
CREATE INDEX ncr_relations_pair ON ncr_relations (ncr_id, related_ncr_id, decided_at);
ALTER TABLE ncr_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON ncr_relations USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id));
GRANT SELECT, INSERT ON ncr_relations TO goverhub_app;


CREATE OR REPLACE FUNCTION demo_reset_6b() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.system', 'on', true);
  DELETE FROM ncr_relations WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
END $$;
ALTER FUNCTION demo_reset() RENAME TO demo_reset_before_6b;
CREATE FUNCTION demo_reset() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM demo_reset_6b();
  RETURN demo_reset_before_6b();
END $$;
