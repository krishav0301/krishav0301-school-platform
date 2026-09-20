# Spike: BS date conversion

Date: 2026-09-20. Phase 0. Status: **finding is firm; recommendation is a working default awaiting PM.**

## Question

Which library should convert between AD and BS dates, and can we trust it?

## Method

Installed both candidates in a scratch environment and converted **every day from 1944-01-01 to 2042-12-31 (36,160 days)** with each, then compared. Also checked the two dates given in the project documents (1 Ashwin 2083 = 17 Sep 2026, 3 Ashwin 2083 = 19 Sep 2026) and compared month lengths per BS year.

| | `nepali-datetime` 1.0.8.5 | `bikram-sambat` 0.2.0 |
|---|---|---|
| Supported BS range | 1975 to 2100 | 1901 to 2199 |
| Data | A calendar file shipped with the package | Embedded tables |

## Findings

1. **They agree on every BS year from 2000 to 2083.** Same month lengths, same conversions, and both match the two known dates.
2. **They disagree on every BS year from 2084 to 2099** (16 of 16 years). 1,901 of 36,160 days differ. The first differing day is 2027-06-15. They even disagree on whether BS 2084 has 365 or 366 days.
3. Example, BS 2084 month lengths: `nepali-datetime` gives 31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30. `bikram-sambat` gives 31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31.

## Interpretation

The official Nepali calendar for a BS year is published shortly before that year begins. So at September 2026 nothing official exists for BS 2084 or later, and any library data beyond 2083 is a projection. Two libraries projecting differently is exactly what we see. **Neither library can be trusted for future years, and there is no formula to fall back on.**

Limits of this finding: agreement on 2000 to 2083 is reassuring but not proof of correctness. The libraries may share an upstream source. Only two dates were checked against a documented source. BS 2083, the year Royal Softech runs in, should be checked against an official calendar before go-live.

## Consequence for the design

We store AD dates. If a user enters a future BS date (a fee due date in BS 2084, say) and we convert it with a projected year, the stored AD date can be a day wrong once the official calendar is published, and nobody will notice.

## Recommendation (working default)

1. Use **`nepali-datetime`** for conversion inside the date module. It is the more established of the two, and its range (to 2100) is enough.
2. Add a **verified-years gate** in our date module. Conversion is allowed only for BS years on a verified list, currently 2000 to 2083. A conversion outside the list raises an explicit error. Screens that would create a date in an unverified year block it with a clear message. No school-specific data and no hand-typed conversion tables: the gate is only a list of years.
3. **Annual calendar update** (runbook step, each Magh or Falgun): when the official calendar for the next BS year is published, compare the library's output for that year with the official calendar, patch if needed, and add the year to the verified list. Two-person check.
4. Dates of birth store the AD date and the BS date **as entered**, so they always match the certificate (already in the original design).
5. Tests: property test that BS to AD to BS round-trips inside the verified range; boundary tests on month and year ends; the two documented dates.

## Open

- **Source of truth for BS 2083.** We need an official calendar to check against. Ask the client or PM for one they trust.
- **Academic years that span two BS years.** If a session runs across the BS year boundary, the following BS year must be verified before its academic year can be created. This is fine operationally (the official calendar arrives months earlier) but should be confirmed with the client.
- The original `CLAUDE.md` rule "never write your own date conversion tables" still stands. This recommendation adds a verification list, not conversion data.
