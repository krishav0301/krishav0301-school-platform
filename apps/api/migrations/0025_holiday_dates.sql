-- A holiday post names the holiday itself (D-094): the day the school is closed, and for a holiday of
-- more than one day its last day. Before this a holiday had only its "show from" and "hide after" days,
-- and testers read "show from" as the holiday's date, so the post stayed hidden until the holiday.
-- AD calendar days by Nepal's clock, like the other dates. Only a holiday has them, and the last day is
-- never before the first; the service checks the same, and these triggers keep the rule if it is removed.
-- Holidays written before this have no dates; they show as before, and an edit asks for the date.

ALTER TABLE content_items ADD COLUMN holiday_from TEXT CHECK (holiday_from IS NULL OR holiday_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE content_items ADD COLUMN holiday_to TEXT CHECK (holiday_to IS NULL OR holiday_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

CREATE TRIGGER content_items_holiday_dates_insert
BEFORE INSERT ON content_items
WHEN (NEW.kind <> 'holiday' AND (NEW.holiday_from IS NOT NULL OR NEW.holiday_to IS NOT NULL))
  OR (NEW.holiday_to IS NOT NULL AND (NEW.holiday_from IS NULL OR NEW.holiday_to < NEW.holiday_from))
BEGIN
  SELECT RAISE(ABORT, 'holiday dates: only a holiday has them, and the last day is not before the first');
END;

CREATE TRIGGER content_items_holiday_dates_update
BEFORE UPDATE OF kind, holiday_from, holiday_to ON content_items
WHEN (NEW.kind <> 'holiday' AND (NEW.holiday_from IS NOT NULL OR NEW.holiday_to IS NOT NULL))
  OR (NEW.holiday_to IS NOT NULL AND (NEW.holiday_from IS NULL OR NEW.holiday_to < NEW.holiday_from))
BEGIN
  SELECT RAISE(ABORT, 'holiday dates: only a holiday has them, and the last day is not before the first');
END;
