-- Up Migration
CREATE TABLE snapshot (
  week_start date PRIMARY KEY,
  job_id bigint REFERENCES report_job (id) ON DELETE SET NULL,
  overall_rag text NOT NULL CHECK (overall_rag IN ('Red', 'Amber', 'Green')),
  blocker_count integer NOT NULL CHECK (blocker_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER snapshot_set_updated_at BEFORE UPDATE ON snapshot
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- epic_key is '' for work items without an Epic.
CREATE TABLE snapshot_epic (
  week_start date NOT NULL REFERENCES snapshot (week_start) ON DELETE CASCADE,
  epic_key text NOT NULL,
  name text NOT NULL,
  rag text NOT NULL CHECK (rag IN ('Red', 'Amber', 'Green')),
  basis text NOT NULL CHECK (basis IN ('points', 'count')),
  total_units numeric NOT NULL CHECK (total_units >= 0),
  done_units numeric NOT NULL CHECK (done_units >= 0),
  percent_complete numeric NOT NULL CHECK (percent_complete >= 0 AND percent_complete <= 100),
  blocker_count integer NOT NULL CHECK (blocker_count >= 0),
  PRIMARY KEY (week_start, epic_key)
);
