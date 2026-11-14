-- A service report file becomes a vault document of the business: one document per job, one version per report version.
-- The request/task/site it belongs to are read through service_job_id; nothing is copied.
ALTER TABLE documents ADD COLUMN service_job_id uuid REFERENCES service_jobs(id);
CREATE UNIQUE INDEX documents_service_job_uq ON documents (service_job_id) WHERE service_job_id IS NOT NULL;
ALTER TABLE service_job_reports ADD COLUMN document_version_id uuid REFERENCES document_versions(id);
ALTER TABLE service_job_reports ADD COLUMN file_sha256 text;
