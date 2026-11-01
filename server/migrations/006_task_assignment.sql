-- Task assignment. Additive only: no existing row is changed or removed.
--
-- A manager can make one person responsible for a recurring check (template code +
-- equipment) at a site. Tasks generated afterwards are assigned to that person, so staff
-- (who only see work assigned to them) get their checks every day without a manager
-- assigning each one.
CREATE TABLE task_assignment_defaults (
  company_id     uuid NOT NULL REFERENCES companies(id),
  site_id        uuid NOT NULL,
  template_code  text NOT NULL,
  equipment_id   uuid,
  user_id        uuid NOT NULL REFERENCES users(id),
  set_by         uuid NOT NULL REFERENCES users(id),
  set_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id),
  FOREIGN KEY (company_id, equipment_id) REFERENCES equipment(company_id, id)
);
CREATE UNIQUE INDEX task_assignment_defaults_key ON task_assignment_defaults
  (company_id, site_id, template_code, COALESCE(equipment_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE task_assignment_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON task_assignment_defaults USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON task_assignment_defaults TO goverhub_app;

-- Who set the current assignee and when (the audit chain keeps the full history).
ALTER TABLE tasks ADD COLUMN assigned_by uuid REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN assigned_at timestamptz;
