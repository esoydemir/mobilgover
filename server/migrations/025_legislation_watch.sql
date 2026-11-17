-- Daily legislation watch: official-source connectors, a review queue, admin-approved scheduled application.
-- Platform-wide tables (no business data). A change is only ever a PROPOSAL until a reviewer approves it with a reason;
-- applying it goes through the existing rule versions (draft -> review -> approved -> published) and the existing rule engine.

CREATE TABLE legislation_sources (
  code             text PRIMARY KEY,
  name             text NOT NULL,
  base_url         text NOT NULL,
  enabled          boolean NOT NULL DEFAULT true,
  -- A source whose host is not the official one (synthetic test source): everything it yields is an EXAMPLE.
  is_example       boolean NOT NULL DEFAULT false,
  last_attempt_at  timestamptz,
  last_success_at  timestamptz,
  last_error       text,
  last_error_at    timestamptz,
  failures_in_row  integer NOT NULL DEFAULT 0,
  last_items_seen  integer
);

CREATE TABLE legislation_scan_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger      text NOT NULL CHECK (trigger IN ('schedule','manual')),
  actor_id     uuid REFERENCES users(id),
  run_date     date NOT NULL,                       -- Europe/Istanbul calendar day of the run
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','partial','failed')),
  results      jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX legislation_scan_runs_day ON legislation_scan_runs (run_date, trigger, started_at DESC);

-- Last successfully read consolidated text of a watched document (Mevzuat Bilgi Sistemi): the base of the next comparison.
CREATE TABLE legislation_documents (
  source_code    text NOT NULL REFERENCES legislation_sources(code),
  doc_key        text NOT NULL,
  title          text NOT NULL,
  url            text NOT NULL,
  articles       jsonb NOT NULL,
  content_sha256 text NOT NULL,
  retrieved_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_code, doc_key)
);

CREATE TABLE legislation_changes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_code        text NOT NULL REFERENCES legislation_sources(code),
  -- The same publication scanned again has the same key: no second row.
  external_key       text NOT NULL,
  change_type        text NOT NULL CHECK (change_type IN ('new_publication','article_amendment','repeal')),
  scope_area         text NOT NULL DEFAULT 'food_safety',
  doc_ref            text NOT NULL,                  -- e.g. "Resmî Gazete 33403" / "Kanun 5996"
  doc_title          text NOT NULL,
  article_ref        text,                           -- article id, null when the whole document is concerned
  source_url         text NOT NULL,
  published_on       date,
  effective_from     date,
  date_status        text NOT NULL CHECK (date_status IN ('known','unclear')),
  date_note          text,
  old_text           text,
  new_text           text,
  suggestion         jsonb NOT NULL DEFAULT '{}',    -- automatic comparison: a hint for the reviewer, never a decision
  is_example         boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','drafted','scheduled','applied','rejected')),
  proposal           jsonb,                          -- proposed rule version (draft input), edited by an author
  proposal_by        uuid REFERENCES users(id),
  proposal_at        timestamptz,
  rule_version_id    uuid REFERENCES rule_versions(id),
  drafted_by         uuid REFERENCES users(id),
  drafted_at         timestamptz,
  approved_by        uuid REFERENCES users(id),
  approved_at        timestamptz,
  approve_reason     text,
  rejected_by        uuid REFERENCES users(id),
  rejected_at        timestamptz,
  reject_reason      text,
  apply_on           date,
  applied_at         timestamptz,
  apply_result       jsonb,
  detected_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_code, external_key),
  CHECK (status <> 'rejected' OR (reject_reason IS NOT NULL AND length(btrim(reject_reason)) > 0)),
  CHECK (status NOT IN ('scheduled','applied') OR (approve_reason IS NOT NULL AND length(btrim(approve_reason)) > 0 AND apply_on IS NOT NULL))
);
CREATE INDEX legislation_changes_status ON legislation_changes (status, detected_at DESC);
CREATE INDEX legislation_changes_apply ON legislation_changes (apply_on) WHERE status = 'scheduled';

GRANT SELECT, INSERT, UPDATE ON legislation_sources, legislation_scan_runs, legislation_documents, legislation_changes TO goverhub_app;
