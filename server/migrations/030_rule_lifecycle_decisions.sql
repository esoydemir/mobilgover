-- GH-03 / B-13: three separate decisions on a rule version.
--   iade (return to draft)  in_review/approved -> draft     : author fixes and resubmits; earlier area reviews no longer count
--   ret (reject)            in_review/approved -> rejected  : terminal, reasoned
--   geri çekme (withdraw)   published          -> withdrawn : terminal, reasoned; future work stops, open work goes to review
ALTER TABLE rule_versions DROP CONSTRAINT rule_versions_status_check;
ALTER TABLE rule_versions ADD CONSTRAINT rule_versions_status_check
  CHECK (status IN ('draft','in_review','approved','published','retired','rejected','withdrawn'));
ALTER TABLE rule_versions
  ADD COLUMN status_reason     text,
  ADD COLUMN status_changed_by uuid REFERENCES users(id),
  ADD COLUMN status_changed_at timestamptz,
  ADD COLUMN returned_at       timestamptz;

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
    OR (OLD.status = 'in_review' AND NEW.status IN ('draft','approved','rejected'))
    OR (OLD.status = 'approved' AND NEW.status IN ('published','draft','rejected'))
    OR (OLD.status = 'published' AND NEW.status IN ('retired','withdrawn'))) THEN
    RAISE EXCEPTION 'invalid rule status change % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;
