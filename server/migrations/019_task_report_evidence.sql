-- GM-30 devamı: a task whose rule accepts a service report as its document evidence can be tied to one reviewed version of that report,
-- without uploading the file again. The row records which version the task relied on; it is never deleted, and once the task
-- is closed (completion_basis) a later revision of the report does not change what the closed task rested on.
CREATE TABLE task_report_evidence (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  task_id              uuid NOT NULL,
  document_id          uuid NOT NULL,
  document_version_id  uuid NOT NULL REFERENCES document_versions(id),
  version_number       int  NOT NULL,
  file_sha256          text,
  selected_by          uuid NOT NULL REFERENCES users(id),
  selected_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- active: counts while the version is still the reviewed latest; replaced: another version was chosen;
  -- stale: a newer revision arrived while the task was open, so it must be reviewed and chosen again.
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active','replaced','stale')),
  status_reason        text,
  status_changed_at    timestamptz,
  completion_basis     boolean NOT NULL DEFAULT false,
  FOREIGN KEY (company_id, task_id) REFERENCES tasks(company_id, id),
  FOREIGN KEY (company_id, document_id) REFERENCES documents(company_id, id)
);
CREATE UNIQUE INDEX task_report_evidence_active ON task_report_evidence (task_id, document_id) WHERE status = 'active';
CREATE INDEX task_report_evidence_doc ON task_report_evidence (document_id);
ALTER TABLE task_report_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON task_report_evidence USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id));
GRANT SELECT, INSERT, UPDATE ON task_report_evidence TO goverhub_app;
