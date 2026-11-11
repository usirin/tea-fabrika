#!/bin/sh
# Usage: mut.sh <arm> <test path>. Run from the worktree root. One Stryker run of the sampled
# machine.ts mutants against one law file, on the host (no Docker), settings copied from
# .agents/skills/mutation/scripts/run.sh except concurrency 3 and no incremental reuse.
set -eu
ARM=$1; TEST=$2; M=$PWD/runs/exp-law-size/$ARM; rm -rf "$M"; mkdir -p "$M"
S=packages/pipeline/node_modules/@stryker-mutator
cat > vitest.mutation.config.ts <<TS
import {testConfig as base} from "./vitest.config.ts";
import {defineConfig} from "vitest/config";
export default defineConfig({...base, test: {...base.test, include: ["$TEST"], maxWorkers: 1,
  testTimeout: 10_000, hookTimeout: 10_000,
  exclude: [...(base.test?.exclude ?? []), "**/node_modules/**", "**/dist/**"]}});
TS
cat > "$M/stryker.json" <<JSON
{"testRunner": "vitest", "vitest": {"configFile": "vitest.mutation.config.ts", "related": false},
 "plugins": ["$PWD/$S/vitest-runner/dist/src/index.js"], "coverageAnalysis": "perTest",
 "mutate": $(cat runs/exp-law-size/ranges.json), "inPlace": true, "ignoreStatic": false, "timeoutMS": 5000, "concurrency": 3,
 "reporters": ["json", "event-recorder", "progress-append-only"],
 "jsonReporter": {"fileName": "$M/report.json"}, "eventReporter": {"baseDir": "$M/events"},
 "tempDirName": "$M/tmp", "tsconfigFile": "$M/no-tsconfig/absent.json", "cleanTempDir": "always",
 "ignorePatterns": [".claude", "runs"]}
JSON
date +%s > "$M/start"
nice -n 15 volta run --node 26.13.0 node "$S/core/bin/stryker.js" run "$M/stryker.json" --force > "$M/log.txt" 2>&1 || echo "stryker exit $?" >> "$M/log.txt"
date +%s > "$M/end"
rm -f vitest.mutation.config.ts
