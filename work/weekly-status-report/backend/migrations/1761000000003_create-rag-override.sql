-- Up Migration
-- A manual RAG override applies to exactly one week (FR-022). epic_key is '' for the overall status.
CREATE TABLE rag_override (
  week_start date NOT NULL,
  scope text NOT NULL CHECK (scope IN ('overall', 'epic')),
  epic_key text NOT NULL DEFAULT '',
  rag text NOT NULL CHECK (rag IN ('Red', 'Amber', 'Green')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, scope, epic_key),
  CHECK ((scope = 'overall' AND epic_key = '') OR (scope = 'epic' AND epic_key <> ''))
);

CREATE TRIGGER rag_override_set_updated_at
  BEFORE UPDATE ON rag_override
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
