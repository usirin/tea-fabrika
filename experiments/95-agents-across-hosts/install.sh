#!/bin/sh
# Fills the Linux node_modules volume for host B, once. Runs inside the image, with the repo
# mounted read-only at /repo and the volume at /ws/node_modules:
#
#   docker run --rm --user root -v "$PWD:/repo:ro" -v exp95-node-modules:/ws/node_modules \
#     --entrypoint sh exp95-host /repo/experiments/95-agents-across-hosts/install.sh
#
# It copies the workspace's manifests and lockfile (no source) to a writable folder and runs
# the same frozen install as on the Mac, production dependencies only, scripts off. pnpm
# names its store folders from the lockfile, so the repo's own per-package links
# (packages/*/node_modules) find their targets in the volume once it is mounted over
# /repo/node_modules.
set -eu
cd /repo
for f in package.json pnpm-lock.yaml pnpm-workspace.yaml; do cp "$f" "/ws/$f"; done
for dir in packages/* programs/* packs/* wip legacy; do
	if [ -f "$dir/package.json" ]; then
		mkdir -p "/ws/$dir"
		cp "$dir/package.json" "/ws/$dir/package.json"
	fi
done
cd /ws
pnpm install --frozen-lockfile --prod --ignore-scripts --config.confirmModulesPurge=false
chown -R node:node /ws/node_modules
