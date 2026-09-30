-- 066-a-run-log-carries-its-progress.sql
--
-- A sync run writes where it stands to its own log row as it goes (#1131):
-- the phase, the line the panel shows over the bar, the object it is on, how
-- far through the items it is, and when it last said so. The running counts
-- go to the total_* columns the close already writes. Until now all of it
-- lived only in the backend's memory, so a restart left the row with every
-- total at 0 and the card showing the run before's verdict. The startup sweep
-- reads these columns to close such a row with how far it got, and the status
-- endpoint reads them for a run this process does not hold.
-- Re-runnable: ADD COLUMN IF NOT EXISTS, and the CHECK rides its column.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sync_logs
  ADD COLUMN IF NOT EXISTS phase VARCHAR(20)
    CHECK (phase IN ('fetching', 'processing', 'assigning'));
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS status_message TEXT;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS current_item TEXT;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS progress_done INTEGER;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS progress_total INTEGER;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS progress_at TIMESTAMPTZ;

COMMENT ON COLUMN experience_sync_logs.phase IS 'The phase the run was last in while it ran: fetching, processing or assigning. Written with its progress (#1131) and left as it stood when the row closed, so a run the startup sweep closed says whether it had got past collecting from the source. NULL on runs from before the column.';
COMMENT ON COLUMN experience_sync_logs.status_message IS 'The line the admin panel shows over the running bar, as the run last wrote it.';
COMMENT ON COLUMN experience_sync_logs.current_item IS 'The object the run was on when it last wrote its progress; empty between objects.';
COMMENT ON COLUMN experience_sync_logs.progress_done IS 'Items the run had gone through when it last wrote its progress.';
COMMENT ON COLUMN experience_sync_logs.progress_total IS 'Items the run was given to go through; 0 while it is still collecting. The startup sweep closes a killed run with this as its total_fetched, the figure a failed run closes with.';
COMMENT ON COLUMN experience_sync_logs.progress_at IS 'When the running run last wrote its progress: at each change of phase, at most every two seconds while its counts move, and every fifteen seconds while they do not. Its progress writes only ever touch a running row.';

COMMIT;
