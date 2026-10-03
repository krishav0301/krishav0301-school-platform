#!/bin/bash
# The admin FUT, start to finish, on a fresh local school. Stops at the first script that exits non-zero.
cd "$(dirname "$0")"
# Sign-in locks an email after 5 failures in 15 minutes. Section 1 fails once on purpose and section 9 three times,
# so the run waits 16 minutes before section 9 to keep them in separate windows.
for s in s01-signin s02-programs s03-programmes s04-people s04b-people p01-year s05-approvals p02-money s06-money-approvals s07-readonly s07b-oversight s08-website s09-account s10-denied s11-phone s12-final; do
  if [ "$s" = s09-account ]; then echo "waiting 16 minutes for the sign-in lockout window"; sleep 960; fi
  echo "=== $s $(TZ=Asia/Kathmandu date +%H:%M:%S)"
  timeout 1200 node $s.cjs 2>&1 | grep -v "^shot " || true
done
echo "=== done $(TZ=Asia/Kathmandu date +%H:%M:%S)"
