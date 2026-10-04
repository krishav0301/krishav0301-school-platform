"""
Checks a candidate BS year's month lengths against astronomy, calibrated on the verified years (docs/spikes/bs-2084.md).

A BS month begins at a sankranti: the sun's entry into a sidereal sign (Baisakh = Mesha, ...). Nepal's almanac computes
it the traditional way, so its month starts differ from modern astronomy by a month-dependent offset and a slow drift
(the Surya Siddhanta year is 3.45 minutes longer than the sidereal year). This script:
  1. computes every sidereal (Lahiri) sankranti from the first verified year to the candidate year, in Nepal time,
     with Swiss Ephemeris (its built-in Moshier ephemeris, so no data files are downloaded);
  2. Test A (no fitting): for each month, the range of hours between the sankranti and the month's first midnight over
     the verified years, and whether the candidate's dates fall inside it;
  3. Test B (fitted): the per-month offset plus yearly drift that reproduce the verified years, checked on years the
     fit never saw, then the candidate year's predicted month starts across every setting that fits.

It is a check, never a source of conversion data (CLAUDE.md section 6): a year is verified only against the published
calendar. Usage:
  pip install pyswisseph
  python3 check.py 2084 31,31,32,31,31,30,30,30,29,30,30,30
"""
import collections, datetime as dt, json, os, sys
import swisseph as swe

GOLDEN = os.path.join(os.path.dirname(__file__), "../../../apps/api/test/fixtures/bs-golden.json")
NPT = dt.timedelta(hours=5, minutes=45)
NAMES = "Baisakh Jestha Asar Shrawan Bhadra Ashwin Kartik Mangsir Poush Magh Falgun Chaitra".split()
DISPUTED = {(2062, 2)}  # the public calendars disagree on this boundary (core/dates DISPUTED_WINDOWS)


def sun(jd):
    return swe.calc_ut(jd, swe.SUN, swe.FLG_SIDEREAL | swe.FLG_MOSEPH)[0][0]


def sankrantis(first_ad, last_ad):
    swe.set_sid_mode(swe.SIDM_LAHIRI, 0, 0)
    out = collections.defaultdict(list)
    jd, end = swe.julday(first_ad.year, first_ad.month, first_ad.day), swe.julday(last_ad.year, last_ad.month, last_ad.day)
    prev = sun(jd)
    while jd < end:
        nxt = sun(jd + 1)
        if int(nxt // 30) != int(prev // 30):
            target, lo, hi = int(nxt // 30) * 30.0, jd, jd + 1
            for _ in range(50):
                mid = (lo + hi) / 2
                if (sun(mid) - target + 180) % 360 - 180 < 0:
                    lo = mid
                else:
                    hi = mid
            y, m, d, h = swe.revjul(hi)
            out[int(nxt // 30) % 12].append(dt.datetime(y, m, d) + dt.timedelta(hours=h) + NPT)
        prev, jd = nxt, jd + 1
    return out


def month_starts(year, start_ad, months):
    day, rows = start_ad, []
    for i, n in enumerate(months):
        rows.append((year, i + 1, day))
        day += dt.timedelta(days=n)
    return rows, day


def main():
    year, months = int(sys.argv[1]), [int(x) for x in sys.argv[2].split(",")]
    golden = json.load(open(GOLDEN))["years"]
    verified, next_start = [], None
    for g in golden:
        rows, next_start = month_starts(g["year"], dt.date.fromisoformat(g["startAd"]), g["months"])
        verified += rows
    assert golden[-1]["year"] == year - 1, "the candidate must be the year after the last verified one"
    cand, after = month_starts(year, next_start, months)
    cand.append((year + 1, 1, after))  # the candidate's last month ends where the next year begins
    sk = sankrantis(verified[0][2] - dt.timedelta(days=40), after + dt.timedelta(days=40))
    near = lambda m, d: min(sk[m - 1], key=lambda t: abs((t.date() - d).days))
    lag = lambda r: (dt.datetime.combine(r[2], dt.time()) - near(r[1], r[2])).total_seconds() / 3600
    known = [r for r in verified if (r[0], r[1]) not in DISPUTED]

    print(f"Test A: first midnight minus sankranti, hours, per month (verified BS {verified[0][0]} to {year - 1})")
    span = collections.defaultdict(list)
    for r in known:
        span[r[1]].append(lag(r))
    bad_a = 0
    for r in cand:
        lo, hi, L = min(span[r[1]]), max(span[r[1]]), lag(r)
        ok = lo <= L <= hi
        bad_a += not ok
        print(f"  {r[0]} {NAMES[r[1] - 1]:8s} {r[2]}  {L:6.1f} h   seen {lo:6.1f} .. {hi:5.1f}   {'inside' if ok else 'OUTSIDE'}")

    pred = lambda r, a, b: (near(r[1], r[2]) + dt.timedelta(minutes=a + b * (r[0] - 2000))).date()
    def offsets(rows, b):
        good = {}
        for m in range(1, 13):
            mine = [r for r in rows if r[1] == m]
            good[m] = [a for a in range(-36 * 60, 12 * 60) if all(pred(r, a, b) == r[2] for r in mine)]
            if not good[m]:
                return None
        return good
    drifts = [b / 20 for b in range(0, 161)]
    fits = {b: g for b in drifts if (g := offsets(known, b))}
    print(f"\nTest B: drift values (min/yr) that reproduce every verified month: {min(fits)} .. {max(fits)} (theory 3.45)" if fits else "\nTest B: no setting reproduces the verified years")
    held = [r for r in known if r[0] >= year - 14]
    early = {b: g for b in drifts if (g := offsets([r for r in known if r[0] < year - 14], b))}
    hits = max((sum(any(pred(r, a, b) == r[2] for a in [g[r[1]][len(g[r[1]]) // 2]]) for r in held), b) for b, g in early.items()) if early else (0, None)
    print(f"  fitted on BS {verified[0][0]} to {year - 15} only, it predicts {hits[0]} of {len(held)} months of BS {year - 14} to {year - 1}")
    bad_b = 0
    for r in cand:
        got = sorted({pred(r, a, b) for b, g in fits.items() for a in g[r[1]]})
        ok = got == [r[2]]
        bad_b += not ok
        print(f"  {r[0]} {NAMES[r[1] - 1]:8s} candidate {r[2]}  astronomy {' or '.join(map(str, got))}  {'agree' if ok else 'DIFFER'}")
    print(f"\nTest A: {bad_a} of {len(cand)} month starts outside the verified range; Test B: {bad_b} of {len(cand)} differ.")


if __name__ == "__main__":
    main()
