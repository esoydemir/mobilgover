-- A service report that belongs to another case (same branch and equipment) can be tied to a follow-up task only with a stated basis.
-- The tie records how the report relates to the task, which case it belongs to and the reason given, so a shared visit is explicit.
ALTER TABLE task_report_evidence
  ADD COLUMN relation   text NOT NULL DEFAULT 'direct' CHECK (relation IN ('direct','equipment')),
  ADD COLUMN case_id    uuid,
  ADD COLUMN basis_note text;
