-- Staff (Phase 3, slice 3a, D-059): the home section of a teacher. A teacher's role assignment has scope
-- 'assigned' and no section, so their section lives here; it decides which Co-ordinator may manage them.
-- A Co-ordinator's or an Accountant's section is already in their role assignment, so they have no row.

CREATE TABLE staff_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users (id),
  home_section_id INTEGER REFERENCES sections (id)
);
