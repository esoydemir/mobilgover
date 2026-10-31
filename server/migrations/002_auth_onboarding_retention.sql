-- E-mail sign-in, second factor, rule review areas and the retention matrix.

-- ─── Sign-in ────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE sessions ADD COLUMN mfa_satisfied boolean NOT NULL DEFAULT false;

-- One-time e-mail codes. Only a hash of the code is stored.
CREATE TABLE login_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_challenges_email ON login_challenges (email, created_at DESC);

-- TOTP second factor. The secret is encrypted with a key from the environment.
CREATE TABLE mfa_totp (
  user_id       uuid PRIMARY KEY REFERENCES users(id),
  secret_enc    text NOT NULL,
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Short-lived ticket between "e-mail code ok" and "second factor ok".
CREATE TABLE mfa_tickets (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0
);

-- Development mail transport only: messages are kept here instead of being sent.
CREATE TABLE dev_mail_outbox (
  id          bigserial PRIMARY KEY,
  to_email    text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Rule review by subject area ────────────────────────────────────────────
-- The product owner approves pilot content; provisions outside their field
-- also need a review by someone registered for that area.

CREATE TABLE reviewer_areas (
  user_id  uuid NOT NULL REFERENCES users(id),
  area     text NOT NULL,
  PRIMARY KEY (user_id, area)
);

ALTER TABLE rule_versions ADD COLUMN required_review_areas text[] NOT NULL DEFAULT '{}';

CREATE TABLE rule_area_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_version_id  uuid NOT NULL REFERENCES rule_versions(id),
  area             text NOT NULL,
  reviewer_id      uuid NOT NULL REFERENCES users(id),
  decision         text NOT NULL CHECK (decision IN ('approved','changes_requested')),
  notes            text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION rule_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.condition IS DISTINCT FROM OLD.condition OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.provision_ids IS DISTINCT FROM OLD.provision_ids OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.obligation_title IS DISTINCT FROM OLD.obligation_title
    OR NEW.required_facts IS DISTINCT FROM OLD.required_facts OR NEW.ambiguity_note IS DISTINCT FROM OLD.ambiguity_note
    OR NEW.required_review_areas IS DISTINCT FROM OLD.required_review_areas) THEN
    RAISE EXCEPTION 'rule version % is % and its content cannot change', OLD.id, OLD.status;
  END IF;
  IF NOT (
       (OLD.status = NEW.status)
    OR (OLD.status = 'draft' AND NEW.status = 'in_review')
    OR (OLD.status = 'in_review' AND NEW.status IN ('draft','approved'))
    OR (OLD.status = 'approved' AND NEW.status = 'published')
    OR (OLD.status = 'published' AND NEW.status = 'retired')) THEN
    RAISE EXCEPTION 'invalid rule status change % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;

-- ─── Retention matrix ───────────────────────────────────────────────────────
-- One row per record type. Periods start empty; nothing is deleted
-- automatically, and a period becomes usable only after a second person
-- approves it.

CREATE TABLE retention_policies (
  record_type    text PRIMARY KEY,
  description    text NOT NULL,
  period_months  integer CHECK (period_months IS NULL OR period_months > 0),
  legal_basis    text,
  status         text NOT NULL DEFAULT 'unset' CHECK (status IN ('unset','proposed','approved')),
  proposed_by    uuid REFERENCES users(id),
  proposed_at    timestamptz,
  approved_by    uuid REFERENCES users(id),
  approved_at    timestamptz,
  CHECK (status = 'unset' OR (period_months IS NOT NULL AND legal_basis IS NOT NULL AND proposed_by IS NOT NULL)),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_by <> proposed_by))
);

INSERT INTO retention_policies (record_type, description) VALUES
  ('audit_events', 'Denetim izi olayları'),
  ('evidence_files', 'Kanıt dosyaları (fotoğraf, belge, cihaz kaydı)'),
  ('measurements', 'Ölçüm kayıtları'),
  ('tasks', 'Görevler ve sonuçları'),
  ('nonconformities', 'Uygunsuzluk ve CAPA kayıtları'),
  ('profile_facts', 'İşletme profili geçmişi'),
  ('obligations', 'Yükümlülük kararları ve gerekçeleri'),
  ('personnel_data', 'Personel kişisel verileri'),
  ('service_records', 'Hizmet talebi, teklif ve ziyaret kayıtları'),
  ('sessions_and_login', 'Oturum ve giriş kayıtları');

-- ─── Grants ─────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT ON login_challenges, mfa_totp, mfa_tickets, dev_mail_outbox, reviewer_areas, rule_area_reviews, retention_policies TO goverhub_app;
GRANT UPDATE ON login_challenges, mfa_totp, mfa_tickets, users, sessions, retention_policies TO goverhub_app;
GRANT DELETE ON mfa_tickets TO goverhub_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO goverhub_app;
