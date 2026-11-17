-- Source health detail for the live legislation watch: what kind of failure, and how many documents the last good read covered.
ALTER TABLE legislation_sources
  ADD COLUMN IF NOT EXISTS last_error_kind text,
  ADD COLUMN IF NOT EXISTS last_docs_read  integer;
