-- GH-05: document vault. Keep purpose is separate from the use that satisfies an obligation (document_links);
-- "has an end date" / "has no end date" / "date not known yet" are three states, never inferred from the title;
-- a review date is separate from the end; reminder window and addressee are chosen per document.
ALTER TABLE documents DROP CONSTRAINT documents_doc_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_doc_type_check
  CHECK (doc_type IN ('business_license','food_registration','calibration_certificate','maintenance_report','training_certificate',
                      'health_certificate','insurance','contract','pest_report','signature_circular','other'));
ALTER TABLE documents
  ADD COLUMN keep_purpose    text,
  ADD COLUMN responsible_id  uuid REFERENCES users(id),
  ADD COLUMN remind_days     integer CHECK (remind_days BETWEEN 1 AND 365),
  ADD COLUMN remind_user_id  uuid REFERENCES users(id),
  ADD COLUMN review_on       date;

ALTER TABLE document_versions
  ADD COLUMN end_kind text NOT NULL DEFAULT 'unknown' CHECK (end_kind IN ('dated','none','unknown'));
-- Existing rows: a stored end date is "dated"; a missing one stays "unknown" (it was never declared to have none).
UPDATE document_versions SET end_kind = 'dated' WHERE valid_until IS NOT NULL;
-- An end date always means "dated"; "dated" without a date is impossible. Writers that only set valid_until (service reports, OCR) keep working.
CREATE FUNCTION document_end_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.valid_until IS NOT NULL THEN NEW.end_kind := 'dated';
  ELSIF NEW.end_kind = 'dated' THEN NEW.end_kind := 'unknown';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_end_kind_trg BEFORE INSERT OR UPDATE ON document_versions FOR EACH ROW EXECUTE FUNCTION document_end_kind();
