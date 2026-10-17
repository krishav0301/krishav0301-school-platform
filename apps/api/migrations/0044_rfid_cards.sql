-- RFID cards (D-174, slice 1 of tap attendance): which card number belongs to which person.
--
-- A card belongs to one student or one user (a teacher or other staff member), never both. A number is never reused,
-- even after the card is retired: a found card is replaced with a new one, so history never points two people at one
-- number. A person has at most one active card. Nothing is deleted; a card is retired (lost, damaged), and only that
-- one move is allowed. Whether the owner may still use the card (a student who left, a deactivated user) is worked
-- out when the card is read, not copied here.

CREATE TABLE rfid_cards (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  card_number TEXT NOT NULL UNIQUE CHECK (card_number GLOB '[0-9A-Z]*' AND card_number NOT GLOB '*[^0-9A-Z]*' AND length(card_number) BETWEEN 4 AND 32),
  student_id INTEGER REFERENCES students (id),
  user_id INTEGER REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  -- Why the card was retired; also the reason a replacement was made.
  retire_reason TEXT CHECK (retire_reason IS NULL OR length(trim(retire_reason)) BETWEEN 3 AND 300),
  issued_at TEXT NOT NULL,
  issued_by_user_id INTEGER NOT NULL REFERENCES users (id),
  retired_at TEXT,
  retired_by_user_id INTEGER REFERENCES users (id),
  CHECK ((student_id IS NULL) <> (user_id IS NULL)),
  CHECK ((status = 'retired') = (retired_at IS NOT NULL AND retired_by_user_id IS NOT NULL AND retire_reason IS NOT NULL))
);

-- At most one active card per student and per user.
CREATE UNIQUE INDEX rfid_cards_one_per_student ON rfid_cards (student_id) WHERE status = 'active' AND student_id IS NOT NULL;
CREATE UNIQUE INDEX rfid_cards_one_per_user ON rfid_cards (user_id) WHERE status = 'active' AND user_id IS NOT NULL;
CREATE INDEX rfid_cards_student ON rfid_cards (student_id) WHERE student_id IS NOT NULL;
CREATE INDEX rfid_cards_user ON rfid_cards (user_id) WHERE user_id IS NOT NULL;

CREATE TRIGGER rfid_cards_no_delete BEFORE DELETE ON rfid_cards
BEGIN SELECT RAISE(ABORT, 'a card is retired, never deleted'); END;

CREATE TRIGGER rfid_cards_rules BEFORE UPDATE ON rfid_cards
BEGIN
  SELECT RAISE(ABORT, 'a card only moves from active to retired')
   WHERE OLD.status <> 'active' OR NEW.status <> 'retired'
      OR NEW.card_number <> OLD.card_number OR NEW.public_id <> OLD.public_id OR NEW.issued_at <> OLD.issued_at
      OR NEW.issued_by_user_id <> OLD.issued_by_user_id
      OR COALESCE(NEW.student_id, 0) <> COALESCE(OLD.student_id, 0) OR COALESCE(NEW.user_id, 0) <> COALESCE(OLD.user_id, 0);
END;
