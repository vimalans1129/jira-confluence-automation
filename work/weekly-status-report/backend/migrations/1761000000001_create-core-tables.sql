-- Up Migration
CREATE TABLE setting (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER setting_set_updated_at BEFORE UPDATE ON setting
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE audit_entry (
  id bigserial PRIMARY KEY,
  entity text NOT NULL,
  entity_key text NOT NULL,
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entry_entity_idx ON audit_entry (entity, entity_key, created_at DESC);

CREATE TABLE report_job (
  id bigserial PRIMARY KEY,
  week_start date NOT NULL,
  time_zone text NOT NULL,
  dry_run boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  stage text,
  error_code text,
  error_message text,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  report jsonb,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_job_week_idx ON report_job (week_start, created_at DESC);
CREATE UNIQUE INDEX report_job_one_active_per_week
  ON report_job (week_start) WHERE status IN ('queued', 'running');
CREATE TRIGGER report_job_set_updated_at BEFORE UPDATE ON report_job
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE report_deck (
  week_start date PRIMARY KEY,
  job_id bigint REFERENCES report_job (id) ON DELETE SET NULL,
  file_name text NOT NULL,
  content bytea NOT NULL,
  stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER report_deck_set_updated_at BEFORE UPDATE ON report_deck
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE issue_history (
  issue_key text PRIMARY KEY,
  jira_updated timestamptz NOT NULL,
  history jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX issue_history_jira_updated_idx ON issue_history (jira_updated);
CREATE TRIGGER issue_history_set_updated_at BEFORE UPDATE ON issue_history
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sync_state (
  project_key text PRIMARY KEY,
  last_success_at timestamptz,
  last_full_reconcile_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER sync_state_set_updated_at BEFORE UPDATE ON sync_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
