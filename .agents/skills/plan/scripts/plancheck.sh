#!/bin/sh
# plancheck.sh <plan.md>: list every repo path the plan names that is an exam path, so the lead checks
# the plan gives each one to the tests step before approving it. Exits 1 when it finds any.
here=$(cd "$(dirname "$0")" && pwd -P)
plan=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
paths=$(grep -o '`[A-Za-z0-9_./*-]*/[A-Za-z0-9_./*-]*`' "$plan" | tr -d '`' | sort -u)
cd "$here/../../../.." && python3 "$here/../../step-commit/scripts/exam.py" exam-paths.json $paths && echo "no exam paths named"
