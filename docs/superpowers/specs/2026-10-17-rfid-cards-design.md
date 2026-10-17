# RFID cards: the card registry (first slice of tap attendance)

Status: slice 1 of 3, agreed in chat with the PM on 2026-10-17 (D-174). Slice 1 only links a card to a person. Slice 2 is the gate page and the scan record; slice 3 is the end-of-day Absent job, with the Saturday and holiday rules.

## Intent

Everyone in the school (students, teachers, other staff) carries an NFC/RFID card. A USB reader on a gate computer types the card's number into a web page; later slices turn that tap into a Present mark with a time. This slice makes the school ready for that: every person can be given one card, and the platform knows whose card a number is.

## Goals

- A card number belongs to exactly one person, ever. A person has at most one active card.
- A lost card is retired and a new one linked; the history is kept.
- The Co-ordinator links and retires cards for students and teachers. The Admin does it for Co-ordinators and Accountants. The Super Admin can do it for anyone.
- Every change is one audited batch, checked again inside the batch (D-021).
- The feature is the optional module `card_attendance`, **off unless a school's pack turns it on**. Royal Softech's pack turns it on. A school with no entry has no cards, so Lahan (frozen, D-170) is unchanged until the PM asks for it.

## Non-goals

- No scan endpoint, no gate page, no attendance marking, no end-of-day job (slices 2 and 3).
- No bulk import of card numbers (a later, small addition once the PM has the card list).
- No staff ID number and no card printing; photos wait for uploads (D-020).

## Rules (decided here, marked as my calls)

- The number is what the reader types. Stored as typed, trimmed and upper-cased, letters and digits only, 4 to 32 characters. Whether the reader sends decimal or hex is not yet known: `OPEN: reader output format`; slice 2 adds a normaliser once a real reader is tested.
- A number is never reused, even after retirement (my call): a found card must be replaced with a new one, so history never points two people at one number.
- A card only counts while its owner is active: a student who is Left or Graduated, or a deactivated user. This is derived when the card is read, not copied onto the card, so the existing leave, graduation and deactivation code is untouched (my call).
- Replacing a card needs a reason (lost, damaged, other); the first link needs none.
- Cards are removed from no one's record: retiring keeps the row.

## Data

`rfid_cards`: id, public_id, card_number (unique), student_id or user_id (exactly one), status (active or retired), reason, issued_at, issued_by_user_id, retired_at, retired_by_user_id. Partial unique indexes allow one active card per student and per user. Triggers refuse delete and any change except active-to-retired.

## API

- `GET /api/cards/students/{id}` and `GET /api/cards/people/{id}`: the person's current card and history.
- `PUT` on the same paths: link a card, or replace the active one (the old is retired in the same batch).
- `POST .../retire`: retire the active card without a replacement.

Permissions: `cards.view` (Co-ordinator, Admin read, Super Admin) and `cards.manage` (Co-ordinator for students and teachers, Admin for Co-ordinators and Accountants, Super Admin all). A section-scoped Co-ordinator reaches only their own section's students and teachers. The route's body is validated after the permission (D-027).

## Screens

A "Card" panel on the student profile and on the staff row/profile: the card number and date, "Link card" (the reader types into the box), "Replace card" with a reason, "Retire card". Shown only when the module is on. All words in the message catalog.

## Tests

Link, replace, retire; one person per number; one card per person; no delete or edit by SQL; who may do what for each role and scope (generated from the matrix and independent hand-written cases); a section-scoped Co-ordinator against the other section; repeat submit; module off answers not found; the audit entry per change.
