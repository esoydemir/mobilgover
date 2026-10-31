-- Professional network and service marketplace (no payments in this stage).

ALTER TABLE platform_roles DROP CONSTRAINT platform_roles_role_check;
ALTER TABLE platform_roles ADD CONSTRAINT platform_roles_role_check
  CHECK (role IN ('rule_author','rule_reviewer','platform_admin','marketplace_reviewer'));

-- Service categories and the professional credentials each one requires.
CREATE TABLE service_categories (
  code                  text PRIMARY KEY,
  name                  text NOT NULL,
  description           text NOT NULL,
  required_credentials  text[] NOT NULL DEFAULT '{}',
  is_example            boolean NOT NULL DEFAULT false
);

-- Anyone may open a professional profile. A profile alone grants nothing.
CREATE TABLE professional_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES users(id),
  kind          text NOT NULL CHECK (kind IN ('individual','company')),
  display_name  text NOT NULL,
  headline      text NOT NULL DEFAULT '',
  city          text NOT NULL,
  district      text,
  bio           text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Identity, business registration and professional credentials are separate
-- checks; an identity check never stands in for a professional one.
CREATE TABLE professional_verifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       uuid NOT NULL REFERENCES professional_profiles(id),
  kind             text NOT NULL CHECK (kind IN ('identity','business_registration','credential')),
  credential_type  text,
  issuer           text NOT NULL,
  document_ref     text NOT NULL,
  scope_note       text,
  valid_until      date,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  check_method     text,
  notes            text,
  checked_by       uuid REFERENCES users(id),
  checked_at       timestamptz,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'credential') = (credential_type IS NOT NULL)),
  CHECK (status = 'pending' OR (checked_by IS NOT NULL AND checked_at IS NOT NULL AND check_method IS NOT NULL))
);

-- Permission to offer services, per category.
CREATE TABLE service_authorizations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id             uuid NOT NULL REFERENCES professional_profiles(id),
  category_code          text NOT NULL REFERENCES service_categories(code),
  status                 text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  basis_verification_ids uuid[] NOT NULL DEFAULT '{}',
  reason                 text,
  decided_by             uuid REFERENCES users(id),
  decided_at             timestamptz,
  requested_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, category_code),
  CHECK (status = 'pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE TABLE service_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  site_id        uuid NOT NULL,
  category_code  text NOT NULL REFERENCES service_categories(code),
  title          text NOT NULL,
  description    text NOT NULL,
  -- The user's own words are kept; the category is a routing choice, not a diagnosis.
  ncr_id         uuid,
  city           text NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','awarded','completed','cancelled')),
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id),
  FOREIGN KEY (company_id, ncr_id) REFERENCES nonconformities(company_id, id),
  UNIQUE (company_id, id)
);

-- Quotes use the same fields so they can be compared like for like.
CREATE TABLE quotes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           uuid NOT NULL,
  company_id           uuid NOT NULL REFERENCES companies(id),
  provider_profile_id  uuid NOT NULL REFERENCES professional_profiles(id),
  scope                text NOT NULL,
  exclusions           text NOT NULL,
  price_net            numeric(12,2) NOT NULL CHECK (price_net >= 0),
  vat_rate             numeric(5,2) NOT NULL CHECK (vat_rate >= 0 AND vat_rate <= 100),
  materials            text NOT NULL,
  duration_text        text NOT NULL,
  warranty_text        text NOT NULL,
  valid_until          timestamptz NOT NULL,
  status               text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','withdrawn','accepted','rejected')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, request_id) REFERENCES service_requests(company_id, id)
);
CREATE UNIQUE INDEX quotes_one_live_per_provider ON quotes (request_id, provider_profile_id) WHERE status IN ('submitted','accepted');

-- The job. Check-in only records presence; the report, the business's
-- acceptance and (where needed) technical verification are separate.
CREATE TABLE service_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            uuid NOT NULL UNIQUE,
  quote_id              uuid NOT NULL REFERENCES quotes(id),
  company_id            uuid NOT NULL REFERENCES companies(id),
  provider_profile_id   uuid NOT NULL REFERENCES professional_profiles(id),
  status                text NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','checked_in','report_submitted','accepted','disputed')),
  checkin_code          text NOT NULL,
  checked_in_at         timestamptz,
  report                text,
  report_submitted_at   timestamptz,
  accepted_by           uuid REFERENCES users(id),
  accepted_at           timestamptz,
  business_note         text,
  technical_verification text NOT NULL DEFAULT 'not_required' CHECK (technical_verification IN ('not_required','pending','verified')),
  -- Payments are not part of this stage.
  payment_status        text NOT NULL DEFAULT 'not_in_scope' CHECK (payment_status = 'not_in_scope'),
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, request_id) REFERENCES service_requests(company_id, id),
  CHECK (status <> 'accepted' OR (report IS NOT NULL AND accepted_by IS NOT NULL))
);

-- Company-side rows follow the tenant policy. Providers reach them only
-- through service functions that check their category authorizations.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_requests','quotes','service_jobs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id))', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON service_categories, professional_profiles, professional_verifications, service_authorizations,
  service_requests, quotes, service_jobs TO goverhub_app;

-- Demo reset also clears marketplace rows that belong to demo companies.
CREATE OR REPLACE FUNCTION demo_reset() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('app.demo_reset', 'on', true);
  PERFORM set_config('app.system', 'on', true);
  DELETE FROM service_jobs WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM quotes WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM service_requests WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  ALTER TABLE evidence DISABLE TRIGGER evidence_guard;
  DELETE FROM evidence WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  ALTER TABLE evidence ENABLE TRIGGER evidence_guard;
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
