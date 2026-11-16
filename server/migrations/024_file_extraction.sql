-- Text reading from the stored file of a document version (text-layer PDF directly; scans and photos with the local OCR engine).
-- A reading is bound to the version and to the exact file (sha256) it came from; the source text is kept so a person can compare it with the suggestions.
ALTER TABLE document_extractions DROP CONSTRAINT document_extractions_source_check;
ALTER TABLE document_extractions ADD CONSTRAINT document_extractions_source_check CHECK (source IN ('device_text','typed_text','provider','file'));
ALTER TABLE document_extractions
  ADD COLUMN evidence_id      uuid REFERENCES evidence(id),
  ADD COLUMN file_sha256      text,
  ADD COLUMN method           text CHECK (method IS NULL OR method IN ('pdf_text','ocr_pdf','ocr_image')),
  ADD COLUMN source_text      text,
  ADD COLUMN read_confidence  integer,
  ADD COLUMN uncertain_words  jsonb;
CREATE INDEX document_extractions_file ON document_extractions (version_id, file_sha256, method) WHERE file_sha256 IS NOT NULL;
