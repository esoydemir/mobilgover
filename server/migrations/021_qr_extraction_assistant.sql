-- Group 4: QR codes bound to records, reviewed (never auto-accepted) document field extraction, assistant question log.
-- Additive only.

-- A QR code names a record of the business. The token is random and says nothing; whether a scan opens the record is decided on the server
-- from the scanner's own rights, so a code on a wall never opens anything for a person who may not see that record.
CREATE TABLE qr_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  site_id         uuid,
  kind            text NOT NULL CHECK (kind IN ('equipment','document','site')),
  ref_id          uuid NOT NULL,
  label           text NOT NULL,
  token           text NOT NULL UNIQUE CHECK (length(token) >= 20),
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  deactivated_by  uuid REFERENCES users(id),
  deactivated_at  timestamptz,
  deactivate_reason text,
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id)
);
CREATE INDEX qr_codes_ref ON qr_codes (company_id, kind, ref_id);

-- Fields read from a document file (by a person, a phone's text recognition, or a provider later). They are suggestions with the
-- snippet they came from; nothing reaches the document until a person has looked at, edited and confirmed them.
CREATE TABLE document_extractions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  document_id     uuid NOT NULL REFERENCES documents(id),
  version_id      uuid NOT NULL REFERENCES document_versions(id),
  source          text NOT NULL CHECK (source IN ('device_text','typed_text','provider')),
  text_sha256     text NOT NULL,
  suggestions     jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','dismissed')),
  confirmed_fields jsonb,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by      uuid REFERENCES users(id),
  decided_at      timestamptz,
  CHECK (status = 'pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX document_extractions_doc ON document_extractions (document_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['qr_codes','document_extractions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id))', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON qr_codes, document_extractions TO goverhub_app;
