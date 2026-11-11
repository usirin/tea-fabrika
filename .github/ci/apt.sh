#!/bin/sh
# Today's CI. apt on a GitHub-hosted Ubuntu runner that survives a dead Azure mirror.
#
#   sudo sh .github/ci/apt.sh update             refresh the lists, nothing else
#   sudo sh .github/ci/apt.sh install pkg...     refresh the lists, then install
#   sh .github/ci/apt.sh fallback                only drop the Azure mirror, under $APT_ETC
#
# The image already lists three mirrors in /etc/apt/apt-mirrors.txt, Azure first, and its sources
# read them through apt's `mirror+file:` method (actions/runner-images,
# images/ubuntu/scripts/build/configure-apt-sources.sh). apt does fall through to the next mirror,
# but it starts again from Azure for every index file and keeps no memory of a failure
# (runner-images pull request 14643). So with Azure dead, one `update` outlasts any sane limit:
# 32 min on pull request 696 (runner-images issue 14594). Each try here gets a wall-clock limit,
# and after a failed try the Azure mirror leaves the list, so the next try asks archive.ubuntu.com
# first. In 432 green jobs the test job's apt step took at most 246 s; in the six slowest, `update`
# fetched in at most 16 s and `install` in at most 237 s. Hence 60 s and 300 s.
#
# Edge cases, each a test in apt.test.ts:
# - Mirror fine: the first try passes and no file changes.
# - Mirror dead on update: try 1 fails, Azure leaves the list, try 2 passes.
# - Mirror dead on install only: the same; each try refreshes the lists first, so the install
#   resolves its files against the shorter list.
# - Both mirrors dead: three failed tries, an `::error::` line, exit 1.
# - No mirror list, sources in deb822 (`ubuntu.sources`) or the old one-line format
#   (`sources.list`): the Azure address in each is rewritten to archive.ubuntu.com.
# - No mirror list and no sources file: a warning, and the tries go on unchanged.
# - Fallback twice: the second changes nothing.
set -eu

etc=${APT_ETC:-/etc/apt}
azure='azure\.archive\.ubuntu\.com'

# Rewrite one file with a sed script, keeping it when sed fails. No `sed -i`: BSD and GNU differ.
edit() {
  sed "$2" "$1" >"$1.new" && mv "$1.new" "$1"
}

fallback() {
  found=
  if [ -f "$etc/apt-mirrors.txt" ]; then
    edit "$etc/apt-mirrors.txt" "/$azure/d"
    found=1
  fi
  for file in "$etc/sources.list.d/ubuntu.sources" "$etc/sources.list"; do
    if [ -f "$file" ]; then
      edit "$file" "s|http://$azure/ubuntu|http://archive.ubuntu.com/ubuntu|g"
      found=1
    fi
  done
  if [ -z "$found" ]; then
    echo "::warning::no apt mirror list or Ubuntu sources under $etc, nothing to fall back on"
  fi
}

# One try: refresh the lists, then install what was named.
fetch() {
  timeout --kill-after=10 60 apt-get update || return 1
  if [ "$#" -gt 0 ]; then
    timeout --kill-after=10 300 apt-get install -y --no-install-recommends "$@"
  fi
}

verb=${1:-}
[ "$#" -gt 0 ] && shift
case $verb in
  fallback)
    fallback
    exit 0
    ;;
  update)
    [ "$#" -eq 0 ] || { echo "apt.sh: update takes no packages" >&2; exit 2; }
    ;;
  install)
    [ "$#" -gt 0 ] || { echo "apt.sh: install needs packages" >&2; exit 2; }
    ;;
  *)
    echo "apt.sh: usage: apt.sh update | install pkg... | fallback" >&2
    exit 2
    ;;
esac

for try in 1 2 3; do
  if fetch "$@"; then
    exit 0
  fi
  echo "::warning::apt-get $verb failed or passed its limit, try $try of 3; dropping Azure"
  fallback
done
echo "::error::apt-get $verb failed on every mirror, 3 tries"
exit 1
