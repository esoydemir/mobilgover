-- A service request can be opened from a task ("Servis bul"): the request keeps the task it came from, so the task
-- list can show "servis bekleyen" work and the task detail can show its services.
ALTER TABLE service_requests ADD COLUMN task_id uuid REFERENCES tasks(id);
CREATE INDEX service_requests_task_idx ON service_requests (task_id) WHERE task_id IS NOT NULL;
