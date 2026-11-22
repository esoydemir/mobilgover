-- GH-07: the device being fixed and the fate of the product are two decisions. A product assessment is opened for the affected
-- product / batch with the first measure taken, a quantity (or an explicit "unknown"), and an assessor. It stays open until a decision
-- with a written reason is recorded; a case with a product effect cannot be closed while it is open.
CREATE TABLE ncr_product_assessments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  ncr_id           uuid NOT NULL,
  product_ref      text NOT NULL CHECK (length(btrim(product_ref)) >= 2),
  quantity         numeric(14,3) CHECK (quantity >= 0),
  quantity_unit    text,
  quantity_unknown boolean NOT NULL DEFAULT false,
  first_action     text NOT NULL CHECK (length(btrim(first_action)) >= 5),
  assessor_id      uuid NOT NULL REFERENCES users(id),
  opened_by        uuid NOT NULL REFERENCES users(id),
  opened_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  decision         text CHECK (decision IN ('release','rework','hold','destroy','return_supplier','no_product_effect')),
  rationale        text,
  evidence_ids     uuid[] NOT NULL DEFAULT '{}',
  decided_by       uuid REFERENCES users(id),
  decided_at       timestamptz,
  FOREIGN KEY (company_id, ncr_id) REFERENCES nonconformities(company_id, id),
  CHECK ((quantity IS NOT NULL) <> quantity_unknown),
  CHECK (decision IS NULL OR (length(btrim(rationale)) >= 10 AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX ncr_product_assessments_ncr ON ncr_product_assessments (ncr_id, opened_at);
ALTER TABLE ncr_product_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON ncr_product_assessments USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id));
GRANT SELECT, INSERT, UPDATE ON ncr_product_assessments TO goverhub_app;

CREATE OR REPLACE FUNCTION demo_reset_gh07() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.system', 'on', true);
  DELETE FROM ncr_product_assessments WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
END $$;
ALTER FUNCTION demo_reset() RENAME TO demo_reset_before_gh07;
CREATE FUNCTION demo_reset() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM demo_reset_gh07();
  RETURN demo_reset_before_gh07();
END $$;
GRANT EXECUTE ON FUNCTION demo_reset() TO goverhub_app;
REVOKE ALL ON FUNCTION demo_reset() FROM PUBLIC;
