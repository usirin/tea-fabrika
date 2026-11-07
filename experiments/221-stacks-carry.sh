#!/bin/bash
# Experiment 221: does a Gerrit-style replay check carry per-commit step attestations across a
# stacked rebase, and does it catch a builder that slips something in?
# Local only: temp repos in a temp folder, no network, no key, no model, $0. macOS sed (`sed -i ''`).
# Signatures are stood in by "the old commit is in the signed set": the replay is what is tested.
# Run: nice -n 19 bash experiments/221-stacks-carry.sh > experiments/results/221-stacks-carry.txt
# Shas differ on every run (commit times); the kept and stale answers do not.
set -e
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=a GIT_AUTHOR_EMAIL=a@x GIT_COMMITTER_NAME=a GIT_COMMITTER_EMAIL=a@x

# carry OLDBASE OLDHEAD NEWBASE NEWHEAD: pair commits in order; each new commit must be the clean
# replay of its old twin onto the new parent, and the first new parent must be NEWBASE.
carry() {
	local ob=$1 oh=$2 nb=$3 nh=$4
	local olds news; olds=($(git rev-list --reverse --first-parent $ob..$oh)); news=($(git rev-list --reverse --first-parent $nb..$nh))
	[ ${#olds[@]} -eq ${#news[@]} ] || { echo "  stale: count ${#olds[@]} -> ${#news[@]}"; return; }
	local i expect_parent=$(git rev-parse $nb)
	for i in "${!olds[@]}"; do
		local o=${olds[$i]} n=${news[$i]}
		[ "$(git rev-parse $n^)" = "$expect_parent" ] || { echo "  stale: ${n:0:7} parent is not the carried one"; return; }
		[ "$(git rev-list --parents -n1 $n | wc -w)" -eq 2 ] || { echo "  stale: ${n:0:7} is a merge"; return; }
		local t
		if t=$(git merge-tree --write-tree --merge-base=$o^ $n^ $o 2>/dev/null | head -1) && [ "$t" = "$(git rev-parse $n^{tree})" ]; then
			echo "  kept: ${o:0:7} -> ${n:0:7} (replayed)"
		else
			echo "  stale: ${o:0:7} -> ${n:0:7} (replay ${t:0:7}, conflict or tree differs)"; return
		fi
		expect_parent=$n
	done
	echo "  => every attestation carries"
}

setup() {
	rm -rf $ROOT/$1; mkdir -p $ROOT/$1; cd $ROOT/$1; git init -q -b main
	seq 1 30 > a.txt; seq 1 30 > b.txt; echo '{}' > exam.json; git add .; git commit -qm base
	git checkout -qb pr1
	echo '{"t":1}' > exam.json; git commit -qam "pr1 tests"
	sed -i '' 's/^3$/three/' a.txt; git commit -qam "pr1 build"
	git checkout -qb pr2
	echo t2 > b.test.txt; git add b.test.txt; git commit -qm "pr2 tests"
	sed -i '' 's/^20$/twenty/' b.txt; git commit -qam "pr2 build"
	OLD1=$(git rev-parse pr1); OLD2=$(git rev-parse pr2); BASE0=$(git rev-parse main)
}

echo "== 1. main moves, cascading rebase of both, no conflict"
setup s1; git checkout -q main; echo c > c.txt; git add c.txt; git commit -qm m1
git rebase -q main pr1; git rebase -q --onto pr1 $OLD1 pr2
echo " pr1:"; carry $BASE0 $OLD1 main pr1
echo " pr2:"; carry $OLD1 $OLD2 pr1 pr2

echo "== 2. pr1 squash-merged into main, pr2 rebased --onto main (what GitHub does after a bottom merge)"
setup s2; git checkout -q main; git merge -q --squash pr1; git commit -qm "squash pr1"
git rebase -q --onto main $OLD1 pr2
echo " pr2:"; carry $OLD1 $OLD2 main pr2

echo "== 3. attack: builder adds a line while 'rebasing' pr2's build commit"
setup s3; git checkout -q main; echo c > c.txt; git add c.txt; git commit -qm m1
git rebase -q main pr1; git rebase -q --onto pr1 $OLD1 pr2
git checkout -q pr2; echo evil >> exam.json; git commit -q -a --amend --no-edit
echo " pr2:"; carry $OLD1 $OLD2 pr1 pr2

echo "== 4. attack: builder drops pr2's tests commit during the rebase"
setup s4; git checkout -q main; echo c > c.txt; git add c.txt; git commit -qm m1
git rebase -q main pr1; git checkout -q -b pr2new pr1; git cherry-pick $OLD2
echo " pr2:"; carry $OLD1 $OLD2 pr1 pr2new

echo "== 5. main touches a line pr1 changes: conflict, resolved by hand"
setup s5; git checkout -q main; sed -i '' 's/^3$/3-main/' a.txt; git commit -qam m1
git checkout -q pr1; if ! git rebase -q main 2>/dev/null; then sed -i '' '/^<<<<<<<\|^=======\|^>>>>>>>/d' a.txt; grep -v -E '^(<<<<<<<|=======|>>>>>>>|3-main)' a.txt > a2; mv a2 a.txt; git add a.txt; GIT_EDITOR=true git rebase --continue >/dev/null; fi
echo " pr1:"; carry $BASE0 $OLD1 main pr1

echo "== 6. stale replay: builder rebases an OLDER signed version of pr1 (tests v1), not the current one"
setup s6; V1=$(git rev-parse pr1~1); git checkout -q pr1; git reset -q --hard $BASE0; echo '{"t":1,"strict":true}' > exam.json; git commit -qam "pr1 tests v2"; sed -i '' 's/^3$/three/' a.txt; git commit -qam "pr1 build"; CUR=$(git rev-parse pr1)
git checkout -q -b pr1-stale $BASE0; git cherry-pick $V1 $OLD1
echo " claimed old head = the stale one ($(git rev-parse --short $OLD1)):"; carry $BASE0 $OLD1 $BASE0 pr1-stale
echo " claimed old head = the GitHub event's before ($(git rev-parse --short $CUR)):"; carry $BASE0 $CUR $BASE0 pr1-stale
