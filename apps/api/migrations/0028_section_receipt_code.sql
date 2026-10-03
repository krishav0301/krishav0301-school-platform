-- A section's receipt code (D-102, admin FUT F-18): the short marker a receipt number starts with, such as P2-2083-00007.
-- Receipt numbers used to start with the section's key, which since D-095 is generated ("s7e402b08e9") and means
-- nothing to a family. The Principal gives the code when adding a section (a suggestion is offered from the name), and
-- it is fixed once the section has issued a receipt. Sections made before this have none and keep numbering with their
-- key until the Principal gives one; receipts already issued are never edited and keep their number.
ALTER TABLE sections ADD COLUMN receipt_code TEXT CHECK (receipt_code IS NULL OR (length(receipt_code) BETWEEN 2 AND 6 AND receipt_code = upper(receipt_code)));
CREATE UNIQUE INDEX sections_receipt_code ON sections (receipt_code) WHERE receipt_code IS NOT NULL;
