-- Group 3: selected-provider requests, appointments, request-linked messages, persisted "helpful" / "saved" on network posts.
-- Everything is additive; existing rows and behaviour are unchanged.

-- A request can go to several chosen providers (2–5). With no row here and no invited_profile_id it is an open-market request.
CREATE TABLE service_request_invites (
  request_id   uuid NOT NULL,
  company_id   uuid NOT NULL REFERENCES companies(id),
  profile_id   uuid NOT NULL REFERENCES professional_profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, profile_id),
  FOREIGN KEY (company_id, request_id) REFERENCES service_requests(company_id, id)
);

-- Appointment for an awarded job: one live slot at a time; every change keeps its predecessor (status 'superseded').
CREATE TABLE service_appointments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  job_id        uuid NOT NULL REFERENCES service_jobs(id),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  proposed_by   uuid NOT NULL REFERENCES users(id),
  proposed_side text NOT NULL CHECK (proposed_side IN ('business','provider')),
  note          text,
  status        text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','declined','cancelled','superseded')),
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (ends_at > starts_at)
);
CREATE UNIQUE INDEX service_appointments_one_live ON service_appointments (job_id) WHERE status IN ('proposed','confirmed');

-- Messages are tied to one request and one provider (a thread). Before an award the provider does not learn who the business is.
CREATE TABLE service_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  request_id    uuid NOT NULL,
  profile_id    uuid NOT NULL REFERENCES professional_profiles(id),
  sender_id     uuid NOT NULL REFERENCES users(id),
  sender_side   text NOT NULL CHECK (sender_side IN ('business','provider')),
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, request_id) REFERENCES service_requests(company_id, id)
);
CREATE INDEX service_messages_thread ON service_messages (request_id, profile_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_request_invites','service_appointments','service_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id))', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON service_request_invites, service_messages TO goverhub_app;
GRANT SELECT, INSERT, UPDATE ON service_appointments TO goverhub_app;

-- "Helpful" and "saved" on network posts: one row per person, post and kind.
CREATE TABLE network_post_reactions (
  post_id    uuid NOT NULL REFERENCES network_posts(id),
  user_id    uuid NOT NULL REFERENCES network_profiles(user_id),
  kind       text NOT NULL CHECK (kind IN ('helpful','saved')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (post_id, user_id, kind)
);
GRANT SELECT, INSERT, DELETE ON network_post_reactions TO goverhub_app;
