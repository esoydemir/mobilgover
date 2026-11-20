-- A real (non-example) rule may be approved/published only after an authorised person has explicitly set the effective date
-- and the basis for it. The date a draft was written with is a placeholder, never accepted on its own.
ALTER TABLE rule_versions
  ADD COLUMN IF NOT EXISTS effective_confirmed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS effective_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS effective_basis text;
