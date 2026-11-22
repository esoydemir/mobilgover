-- Mevzuat kaydının bir inceleyiciye ATANMASI: dosya atamak, kişiye kalıcı platform yetkisi vermek değildir (ayrı işlem, ayrı denetim kaydı).
ALTER TABLE legislation_changes
  ADD COLUMN assigned_to uuid REFERENCES users(id),
  ADD COLUMN assigned_by uuid REFERENCES users(id),
  ADD COLUMN assigned_at timestamptz,
  ADD COLUMN assign_note text;
CREATE INDEX legislation_changes_assignee ON legislation_changes (assigned_to) WHERE assigned_to IS NOT NULL;
