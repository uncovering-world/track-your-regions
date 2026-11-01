-- 200-a-readership-build-keeps-an-earlier-year.sql
--
-- The readership build kept exactly twelve months ending on the newest dump,
-- and dropped every month before them; a year ending on an earlier month
-- could not be asked for, and loaded by hand it was gone with the next build.
-- The admission review (#2177) needs a second year beside the one the runs
-- read, so the same bars can be derived on both and the churn measured.
--
-- A month now records the twelve-month window it was asked for by name
-- (window_end, #2230): null for the current year's months, which the next
-- build's cleanup drops once they leave the twelve; set for an earlier year
-- an admin asked for, which the cleanup keeps. The current year's reads
-- (readershipYear, countedEditions) read only the months with no window.
--
-- Order-independent with 01-schema.sql, which declares the same column.
-- Re-runnable: the column is added if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE workbench.readership_month_files ADD COLUMN IF NOT EXISTS window_end DATE CHECK (EXTRACT(DAY FROM window_end) = 1);
COMMENT ON COLUMN workbench.readership_month_files.window_end IS 'The first day of the last month of the twelve-month window this month was asked for by name (#2230), or null for a month of the current year, the twelve ending on the newest dump. A current month is dropped by the next build once it leaves the twelve; a month of an earlier year is kept, and no run reads it.';

COMMIT;
