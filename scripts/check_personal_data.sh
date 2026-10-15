#!/usr/bin/env bash
# This repo is public: real players' data lives only in the app's private database. Fails if a tracked file
# contains something shaped like an ITF TennisID (three capital letters and seven digits) or a data export.
set -euo pipefail

status=0

# -w (whole words) rather than \b, which not every git grep regex engine supports.
if git grep -nwE '[A-Z]{3}[0-9]{7}' -- ':!*package-lock.json'; then
  echo "::error::Found TennisID-shaped strings above. Tests use made-up IDs that don't match this shape, such as 'TEST-ID-1'."
  status=1
fi

if git ls-files | grep -iE '\.(xlsx|xls|csv)$|wtn.*\.json$'; then
  echo "::error::Data files are tracked above. Match imports and API dumps must stay out of the repo."
  status=1
fi

[ "$status" -eq 0 ] && echo "No personal data found"
exit "$status"
