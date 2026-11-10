#!/bin/sh
# Today's tooling. Run from the repo root with T, BUILD and RELATED set. SINCE, when set, is the
# commit the sample's diff starts from (the lane's base); else it is BUILD's first parent.
# FINAL=0 reuses unchanged answers in an intermediate round. The default forces fresh answers.
set -eu
: "${T:?T must name the ticket}"
: "${BUILD:?BUILD must name the build commit}"
: "${RELATED:?RELATED must list the test paths}"
case ${FINAL:-1} in 0|1) ;; *) echo "FINAL must be 0 or 1" >&2; exit 1 ;; esac
export T BUILD RELATED
exec node --input-type=module -e '
import {spawn} from "node:child_process";
import {rmSync} from "node:fs";
const child = spawn("sh", ["-eu"], {detached: true, stdio: "inherit"});
const kill = (signal) => { try { process.kill(-child.pid, signal); } catch (e) {
  if (e.code !== "ESRCH") throw e;
}};
let stopped = false;
let hard;
const stop = () => {
  if (stopped) return;
  stopped = true;
  kill("SIGTERM");
  hard = setTimeout(() => kill("SIGKILL"), 1000);
};
const cap = setTimeout(stop, 300_000);
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
child.once("exit", (code) => {
  clearTimeout(cap); clearTimeout(hard);
  try { kill("SIGKILL"); }
  finally {
    rmSync("vitest.mutation.config.ts", {force: true});
    process.exitCode = stopped ? 124 : code ?? 1;
  }
});
' <<'SH'
node --input-type=module -e '
if (!process.env.RELATED.split(",").some(p => p.trim())) {
  console.error("RELATED must list the test paths"); process.exit(1);
}'
M=${TMPDIR:-/tmp}/mut-$T; mkdir -p "$M"
S=packages/pipeline/node_modules/@stryker-mutator
ranges=$(node .agents/skills/mutation/scripts/sample.ts \
  --build "$BUILD" ${SINCE:+--since "$SINCE"} --seed 119120 --max 150 --report "$M/sample.json")
[ -n "$ranges" ] || { echo "no mutation ranges selected" >&2; exit 1; }
# Keep the 10 s limit and the existing nested-Stryker and e2e excludes.
cat > vitest.mutation.config.ts <<'TS'
import {testConfig as base} from "./vitest.config.ts";
import {defineConfig} from "vitest/config";
const include = process.env.RELATED?.split(",").map(p => p.trim()).filter(Boolean);
if (!include?.length) throw new Error("RELATED must list the test paths");
export default defineConfig({...base, test: {...base.test, include, maxWorkers: 1,
  testTimeout: 10_000, hookTimeout: 10_000,
	exclude: [...(base.test?.exclude ?? []), "**/node_modules/**", "**/dist/**",
		"packages/pipeline/src/stages/mutation/stryker*.test.ts",
		"packages/pipeline/src/stages/pipeline/{program,github}.test.ts"]}});
TS
# Stryker parses tsconfigFile with TypeScript's JS API only when it is one of the project's
# files; TypeScript 7 has none. Nothing writes this path, so it is never a project file.
cat > "$M/stryker.json" <<JSON
{"testRunner": "vitest", "vitest": {"configFile": "vitest.mutation.config.ts", "related": false},
 "plugins": ["$PWD/$S/vitest-runner/dist/src/index.js"], "coverageAnalysis": "perTest",
 "mutate": [$ranges], "ignoreStatic": true, "timeoutMS": 5000, "concurrency": 1,
 "incremental": true, "incrementalFile": "$M/incremental.json",
 "reporters": ["json", "event-recorder", "progress-append-only"],
 "jsonReporter": {"fileName": "$M/report.json"}, "eventReporter": {"baseDir": "$M/events"},
 "tempDirName": "$M/tmp", "tsconfigFile": "$M/no-tsconfig/absent.json", "cleanTempDir": "always",
 "ignorePatterns": [".claude", "runs"]}
JSON
set --
[ "${FINAL:-1}" = 0 ] || set -- --force
node "$S/core/bin/stryker.js" run "$M/stryker.json" "$@" > "$M/log.txt" 2>&1
SH
