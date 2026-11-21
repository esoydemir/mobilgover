-- A service visit that covers more than one case. A report belonging to another case of the same equipment can be the REQUIRED evidence of a task
-- only when an authorised person has linked that service job to the second case, with a stated basis. The link names the source case (the request's
-- own case), the target case, the job, the report version at link time, who linked it and why. Free text at selection time is no longer enough.
CREATE TABLE service_case_links (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  ncr_id               uuid NOT NULL,
  job_id               uuid NOT NULL REFERENCES service_jobs(id),
  source_ncr_id        uuid,
  document_id          uuid NOT NULL,
  document_version_id  uuid NOT NULL REFERENCES document_versions(id),
  version_number       int  NOT NULL,
  linked_by            uuid NOT NULL REFERENCES users(id),
  basis                text NOT NULL CHECK (length(btrim(basis)) >= 15),
  linked_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, ncr_id) REFERENCES nonconformities(company_id, id),
  FOREIGN KEY (company_id, document_id) REFERENCES documents(company_id, id),
  UNIQUE (ncr_id, job_id)
);
CREATE INDEX service_case_links_job ON service_case_links (job_id);
ALTER TABLE service_case_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON service_case_links USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id));
GRANT SELECT, INSERT ON service_case_links TO goverhub_app;

ALTER TABLE task_report_evidence DROP CONSTRAINT task_report_evidence_relation_check;
ALTER TABLE task_report_evidence ADD COLUMN service_link_id uuid REFERENCES service_case_links(id);
-- direct: the request was opened from this task or the task is the case's own task. sole: the report's case is the only case of this equipment in 90 days,
-- so the follow-up task cannot belong to another case. linked: another case's service, linked to a case of this equipment.
-- declared: chosen on free-text grounds before links existed. legacy: chosen before the relation was recorded and not provable from record ids.
UPDATE task_report_evidence SET relation = 'declared' WHERE relation = 'equipment';
UPDATE task_report_evidence l SET relation = 'legacy',
       case_id = (SELECT sr.ncr_id FROM service_requests sr JOIN service_jobs j ON j.request_id = sr.id JOIN documents d ON d.service_job_id = j.id WHERE d.id = l.document_id)
 WHERE l.relation = 'direct' AND NOT EXISTS (
   SELECT 1 FROM service_requests sr JOIN service_jobs j ON j.request_id = sr.id JOIN documents d ON d.service_job_id = j.id
     LEFT JOIN nonconformities n ON n.id = sr.ncr_id
    WHERE d.id = l.document_id AND (sr.task_id = l.task_id OR n.task_id = l.task_id));
ALTER TABLE task_report_evidence ADD CONSTRAINT task_report_evidence_relation_check CHECK (relation IN ('direct','sole','linked','declared','legacy'));
