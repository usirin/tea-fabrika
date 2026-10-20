#!/bin/sh
# Experiment 95's install (../95-agents-across-hosts/install.sh), unchanged but for the names.
# Fills the Linux node_modules volume for host B, once. Runs inside the image, with the repo
# mounted read-only at /repo and the volume at /ws/node_modules:
#
#   docker run --rm --user root -v "$PWD:/repo:ro" -v exp98-node-modules:/ws/node_modules \
#     --entrypoint sh exp98-host:local /repo/experiments/98-tea-host-package/install.sh
#
# It copies the workspace's manifests and lockfile (no source) to a writable folder and runs
# the same frozen install as on the Mac, production dependencies only, scripts off.
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
