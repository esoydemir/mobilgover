-- Delivery 6D: what a document is used for (a check, a piece of equipment, an obligation), kept per
-- business; removing a use keeps it in the history (removed_at).
CREATE TABLE document_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  document_id  uuid NOT NULL,
  link_kind    text NOT NULL CHECK (link_kind IN ('task_template','equipment','obligation')),
  ref          text NOT NULL,
  purpose      text NOT NULL CHECK (length(purpose) >= 5),
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_by   uuid REFERENCES users(id),
  removed_at   timestamptz,
  FOREIGN KEY (company_id, document_id) REFERENCES documents(company_id, id)
);
CREATE UNIQUE INDEX document_links_live ON document_links (document_id, link_kind, ref) WHERE removed_at IS NULL;
ALTER TABLE document_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON document_links USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id));
GRANT SELECT, INSERT, UPDATE ON document_links TO goverhub_app;

CREATE OR REPLACE FUNCTION demo_reset_6d() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.system', 'on', true);
  DELETE FROM document_links WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
END $$;
ALTER FUNCTION demo_reset() RENAME TO demo_reset_before_6d;
CREATE FUNCTION demo_reset() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM demo_reset_6d();
  RETURN demo_reset_before_6d();
END $$;
