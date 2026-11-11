#!/bin/sh
# Runs inside the mutation container (0045), as an unprivileged user with no network.
# /in/repo.git is the commit under test, read-only. /out is the only folder that leaves the box.
# Exit: 70 the offline install failed, 71 a related test fails before any mutant, 72 no test left,
# else run.sh's own (124 when its five minutes ran out).
set -eu
usage() {
	cat /sys/fs/cgroup/memory.peak > /out/memory.peak 2>/dev/null || :
	cat /sys/fs/cgroup/cpu.stat > /out/cpu.stat 2>/dev/null || :
}
trap usage EXIT
cd /repo
cp -R /in/repo.git .git
git config core.bare false
git reset -q --hard refs/heads/build
pnpm install --offline --frozen-lockfile > /out/install.txt 2>&1 || exit 70
export TMPDIR=/tmp
# Stryker mutates /repo itself: a sandbox copy would reach other packages' unmutated files
# through their node_modules links (ticket 457). /repo is this container's own throwaway copy.
export IN_PLACE=1
set -f
IFS=,
set -- $RELATED
unset IFS
[ $# -gt 0 ] || exit 72
# The baseline, with vitest's own reporter: which tests passed, failed or skipped themselves here.
node_modules/.bin/vitest run --maxWorkers=1 --reporter=json --outputFile=/out/baseline.json "$@" \
	> /out/baseline.txt 2>&1 || exit 71

# arm <name> <ticket>: one run.sh round, its files copied to /out/<name>.
arm() {
	mkdir -p "/out/$1"
	code=0
	T=$2 sh .agents/skills/mutation/scripts/run.sh > "/out/$1/run.txt" 2>&1 || code=$?
	for f in report.json sample.json log.txt events; do
		[ ! -e "/tmp/mut-$2/$f" ] || cp -R "/tmp/mut-$2/$f" "/out/$1/"
	done
	echo "$code" > "/out/$1/exit"
	# A run stopped at its cap may leave a mutated file behind; the next arm starts clean.
	git reset -q --hard refs/heads/build
}

# With a base, the sample is the lane's own lines, base..build, not the build commit's alone: a
# tip that merged main has main's lines against its first parent (ticket 568).
if git rev-parse -q --verify refs/heads/base > /dev/null; then
	export SINCE=refs/heads/base
fi
arm b "$T"
b=$(cat /out/b/exit)

# Arm a: the same sample against the related tests as the base has them. A test the base lacks
# is left out of that arm. Stryker stops when a test fails in its dry run, so arm a first runs the
# base's tests on the build and keeps only the files that pass; /out/a-kept names them, and
# /out/a-baseline.json says why the rest were dropped (ticket 655).
if git rev-parse -q --verify refs/heads/base > /dev/null; then
	kept=
	for f in "$@"; do
		if git cat-file -e "refs/heads/base:$f" 2> /dev/null; then
			git show "refs/heads/base:$f" > "$f"
			kept="$kept${kept:+,}$f"
		fi
	done
	passing=
	if [ -n "$kept" ]; then
		IFS=,
		set -- $kept
		unset IFS
		node_modules/.bin/vitest run --maxWorkers=1 --reporter=json --outputFile=/out/a-baseline.json "$@" \
			> /out/a-baseline.txt 2>&1 || :
		passing=$(node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
process.stdout.write(r.testResults.filter((t) => t.status === "passed").map((t) => t.name.replace(/^\/repo\//, "")).join(","));
' /out/a-baseline.json 2> /dev/null) || passing=
	fi
	printf '%s\n' "$passing" > /out/a-kept
	if [ -n "$passing" ]; then
		RELATED=$passing arm a "${T}a"
	fi
fi
exit "$b"
