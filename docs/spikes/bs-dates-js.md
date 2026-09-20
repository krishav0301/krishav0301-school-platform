# Spike: BS date library for TypeScript

Date: 2026-09-20. Phase 1, slice 1. Status: **library chosen (D-022). A disputed stretch in BS 2062 is recorded and flagged.**

Follows `bs-dates.md`, which tested Python libraries. The Worker runs JavaScript, so we needed a JavaScript library and proof that it agrees with what we verified.

## Method

Built a reference table of **every day from 1 Baisakh 2000 to 30 Chaitra 2083 (30,681 days)** from `nepali-datetime` (the two Python libraries agreed on all of them). Installed nine npm libraries and converted every day with each.

## Results

| Library | Wrong days out of 30,681 |
|---|---|
| **`@inicrea/bikram-sambat-core` 0.1.3** | **0** |
| `nepali-date-library`, `@sbmdkl/nepali-date-converter`, `bikram-sambat`, `nepali-calendar-panchang`, `nepali-date-converter`, `@remotemerge/nepali-date-converter` | 32 each, the same 32 days |
| `@lacspace/nepali-date` | 122 |
| `bikram-sambat-js` | 765 |

## The disputed stretch

The seven libraries with 32 wrong days all disagree in the same place: **BS 2062, Baisakh to Jestha** (14 May to 14 June 2005). They are not making random errors; they carry a different calendar.

| | Baisakh 2062 | Jestha 2062 |
|---|---|---|
| Group A: both Python libraries and `@inicrea` | 31 days | 31 days |
| Group B: seven npm libraries | 30 days | 32 days |

Public calendars also disagree:
- Hamro Patro: Jestha 1, 2062 is **Sunday 15 May 2005** (Baisakh has 31 days). Agrees with group A.
- ashesh.com.np: Baisakh 2062 has 31 days, last day 14 May 2005. Agrees with group A.
- englishnepalidate.com: Baisakh 2062 has 30 days, last day 13 May 2005. Agrees with group B.

Two of three sites side with group A, including the most widely used one. It is not settled. **Popularity is not evidence:** seven popular libraries share the other answer.

## Decision (D-022)

- Use **`@inicrea/bikram-sambat-core`, pinned to exactly 0.1.3.** MIT, no dependencies, 174 KB, covers BS 1975 to 2100.
- **Risks:** created 20 Aug 2026, so it is a month old, with one maintainer. Mitigation: exact pin, plus a golden test that reproduces every month length and every one of the 30,681 day conversions and fails if an upgrade changes any answer. If the package is abandoned we can replace the converter without changing anything else, because the date module wraps it.
- **Disputed window** `2062-01-31` to `2062-02-31` is flagged by `conversionConfidence()`. A date of birth inside it should be confirmed against the certificate. It affects roughly people born between 14 May and 14 June 2005.
- The verified range stays BS 2000 to 2083. Beyond it, refuse.

## Still open

- **Ask the client for their trusted official calendar** to settle BS 2062 and to check BS 2083 before go-live.
- Someone should look at the printed official calendar for BS 2062 Baisakh. If it turns out group B is right, change the golden data and the module together.
- Nepali digits and Nepali month names are not built (translation catalog, later).
