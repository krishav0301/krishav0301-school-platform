#!/bin/bash
# The Co-ordinator FUT, start to finish, on a fresh local school with the Worker running and secrets.json holding
# {"adminId": "<the Principal's public id>"}. Preconditions (p*) are other people's work through the API.
cd "$(dirname "$0")"
run() { echo "=== $* $(TZ=Asia/Kathmandu date +%H:%M:%S)"; env "$@" 2>&1 | grep -v "^shot \|^      observed" || true; }
run node p00-school.cjs
run node c01-signin.cjs
run node c02-year.cjs
run node c03-curriculum.cjs
run node c04-classes.cjs
run node c05-teachers.cjs
run node c06-teaching.cjs
run node c07-walkins.cjs
run node p01-queue.cjs
run node c08-queue.cjs
run node c09-search.cjs
run node p02-day.cjs
run node c10-attendance.cjs
run node c11-classwork-electives.cjs
run node p03-marks.cjs
run PART=1 node c12-results.cjs
run node p03b-fix.cjs
run PART=2 node c12-results.cjs
run node p04-rechecks.cjs
run node c13-rechecks.cjs
run PART=1 node c14-website.cjs
run node p05-principal.cjs
run PART=2 node c14-website.cjs
run node c15-settings-denied.cjs
run node c16-section-scope.cjs
run node c17-phone-final.cjs
echo "=== done $(TZ=Asia/Kathmandu date +%H:%M:%S)"
