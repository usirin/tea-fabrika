#!/bin/sh
# Today's CI. apt on a GitHub-hosted Ubuntu runner that survives dead Ubuntu mirrors.
#
#   sudo sh .github/ci/apt.sh update             refresh the lists, nothing else
#   sudo sh .github/ci/apt.sh install pkg...     refresh the lists, then install
#   sh .github/ci/apt.sh fallback                only move one step down the chain, under $APT_ETC
#
# The image already lists three mirrors in /etc/apt/apt-mirrors.txt, Azure first, and its sources
# read them through apt's `mirror+file:` method (actions/runner-images,
# images/ubuntu/scripts/build/configure-apt-sources.sh). Its security stanza names
# security.ubuntu.com directly. apt does fall through to the next mirror, but it starts again from
# the top for every index file and keeps no memory of a failure (runner-images pull request
# 14643): each dead mirror costs about 20 s per file, so with Azure dead one `update` outlasts any
# sane limit, 32 min on pull request 696 (runner-images issue 14594). Each try here gets a
# wall-clock limit, and after a failed try the mirror at the top of the list leaves it, so the
# next try asks the next one first. In 432 green jobs the test job's apt step took at most 246 s;
# in the six slowest, `update` fetched in at most 16 s and `install` in at most 237 s. Hence 60 s
# and 300 s.
#
# The image's three mirrors are all Canonical's, under ubuntu.com's own DNS, and on 2026-11-11
# all three went dark to the runners at once (runner-images issues 15296 and 15297). So the first
# fallback adds three full mirrors outside Canonical, each with its own DNS and network, and
# points every Canonical source line, security's included, at the list. The chain is the image's
# three, then those three: six mirrors, six tries. Packages stay checked against apt's own
# keyring, so a mirror only has to answer.
#
# Edge cases, each a test in apt.test.ts:
# - Mirror fine: the first try passes and no file changes.
# - Azure dead on update: try 1 fails, Azure leaves the list, the outside mirrors join its end,
#   security's stanza reads the list, try 2 passes.
# - Azure dead on install only: the same; each try refreshes the lists first, so the install
#   resolves its files against the shorter list.
# - Every Canonical host dead: tries 1 to 3 fail, try 4 passes on the first outside mirror.
# - Every mirror dead: six failed tries, an `::error::` line, exit 1.
# - No mirror list, sources in deb822 (`ubuntu.sources`) or the old one-line format
#   (`sources.list`): the fallback writes the list from the chain and points each Canonical line
#   at it, security's included.
# - No mirror list and no sources file: a warning, and the tries go on unchanged.
# - Fallback many times: each drops one mirror from the top, the outside mirrors join only while
#   a Canonical one is listed, so a dropped one never comes back; a used-up list stays empty with
#   a warning; nothing ever marks a source trusted.
set -eu

etc=${APT_ETC:-/etc/apt}
list=$etc/apt-mirrors.txt
tries=6

# The image's chain, for a runner with no list of its own.
image='http://azure.archive.ubuntu.com/ubuntu/ https://archive.ubuntu.com/ubuntu/'
# Full Ubuntu mirrors outside Canonical's network and DNS, each serving noble for amd64, checked
# 2026-11-11: kernel.org and Princeton in step with archive.ubuntu.com, OSU OSL 4 h behind.
outside='http://mirrors.edge.kernel.org/ubuntu/ http://mirror.math.princeton.edu/pub/ubuntu/
http://ftp.osuosl.org/pub/ubuntu/'
# Any address on Canonical's own archive hosts: azure.archive, archive, a country mirror, security.
canonical='https?://([a-z0-9-]+\.)?(archive|security)\.ubuntu\.com/ubuntu/?'

# Rewrite one file with a sed script, keeping it when sed fails. No `sed -i`: BSD and GNU differ.
edit() {
  sed -E "$2" "$1" >"$1.new" && mv "$1.new" "$1"
}

# Add each mirror not yet in the list to its end, after the ones already there.
append() {
  n=$(wc -l <"$list")
  for mirror in "$@"; do
    if ! grep -qF "$mirror" "$list"; then
      n=$((n + 1))
      printf '%s\tpriority:%s\n' "$mirror" "$n" >>"$list"
    fi
  done
}

fallback() {
  found=
  for file in "$etc/sources.list.d/ubuntu.sources" "$etc/sources.list"; do
    if [ -f "$file" ]; then
      edit "$file" "s#$canonical#mirror+file:$list#g"
      found=1
    fi
  done
  if [ -n "$found" ] && [ ! -f "$list" ]; then
    : >"$list"
    # shellcheck disable=SC2086 # a list of words on purpose
    append $image
  fi
  if [ ! -f "$list" ]; then
    echo "::warning::no apt mirror list or Ubuntu sources under $etc, nothing to fall back on"
    return
  fi
  # Only while a Canonical mirror is still listed, so a dropped outside mirror never comes back.
  if grep -qE "$canonical" "$list"; then
    # shellcheck disable=SC2086 # a list of words on purpose
    append $outside
  fi
  top=$(head -n 1 "$list" | cut -f 1)
  if [ -z "$top" ]; then
    echo "::warning::the apt mirror list is used up"
    return
  fi
  echo "::warning::dropping $top from the top of the mirror list"
  edit "$list" 1d
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

try=1
while [ "$try" -le "$tries" ]; do
  if fetch "$@"; then
    exit 0
  fi
  echo "::warning::apt-get $verb failed or passed its limit, try $try of $tries"
  if [ "$try" -lt "$tries" ]; then
    fallback
  fi
  try=$((try + 1))
done
echo "::error::apt-get $verb failed on every mirror, $tries tries"
exit 1
