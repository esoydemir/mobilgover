-- GH-04: who was responsible for a task before and after each change, structured notification content,
-- and a delivery state per notification so an outward channel can retry without ever sending twice.
CREATE TABLE task_assignment_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  site_id       uuid NOT NULL,
  task_id       uuid NOT NULL,
  previous_id   uuid REFERENCES users(id),
  new_id        uuid REFERENCES users(id),
  changed_by    uuid NOT NULL REFERENCES users(id),
  source        text NOT NULL CHECK (source IN ('single','series','bulk')),
  reason        text,
  changed_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id),
  FOREIGN KEY (company_id, task_id) REFERENCES tasks(company_id, id)
);
CREATE INDEX task_assignment_log_task ON task_assignment_log (task_id, changed_at);
ALTER TABLE task_assignment_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON task_assignment_log USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id));
GRANT SELECT, INSERT ON task_assignment_log TO goverhub_app;

ALTER TABLE notifications
  ADD COLUMN meta              jsonb,
  ADD COLUMN delivered_at      timestamptz,
  ADD COLUMN delivery_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN delivery_error    text,
  ADD COLUMN next_attempt_at   timestamptz;
-- Everything created before this migration was only ever shown in the inbox: nothing is pending.
UPDATE notifications SET delivered_at = created_at WHERE delivered_at IS NULL;

-- Demo reset must clear the new table before tasks are deleted.
CREATE OR REPLACE FUNCTION demo_reset_gh04() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.system', 'on', true);
  DELETE FROM task_assignment_log WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
END $$;
ALTER FUNCTION demo_reset() RENAME TO demo_reset_before_gh04;
CREATE FUNCTION demo_reset() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM demo_reset_gh04();
  RETURN demo_reset_before_gh04();
END $$;
GRANT EXECUTE ON FUNCTION demo_reset() TO goverhub_app;
REVOKE ALL ON FUNCTION demo_reset() FROM PUBLIC;
