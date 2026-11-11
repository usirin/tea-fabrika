// Today's CI, serving both versions. Static workflow shape belongs in lint.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { gated } from "./required.mjs";

export const LANE_FILTER = "packages/pipeline/src/stages/pipeline/lane.";
export const LANE_GLOB = "packages/pipeline/src/stages/pipeline/lane.*.test.ts";
export const inLaneStep = (path: string) => path.includes(LANE_FILTER);

const testFiles = globSync("packages/pipeline/**/*.test.ts", {
  cwd: fileURLToPath(new URL("../../", import.meta.url)),
});

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const map = (value: unknown): Record<string, unknown> => (isMap(value) ? value : {});

const steps = (job: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(job["steps"]) ? job["steps"].filter(isMap) : [];

const commands = (job: Record<string, unknown>) =>
  steps(job).flatMap((step) =>
    typeof step["run"] === "string" ? step["run"].split("\n").map((line) => line.trim()) : [],
  );

const compact = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  const expression = trimmed.startsWith("${{") && trimmed.endsWith("}}") ? trimmed.slice(3, -2).trim() : trimmed;
  // Keep quoted strings and names intact. Only operator spacing cannot change meaning.
  return expression.replace(
    /'(?:[^']|'')*'|\s*(==|!=|&&|\|\|)\s*/g,
    (match, operator: string | undefined) => operator ?? match,
  );
};

const env = {
  BASE: `\${{ github.event.pull_request.base.sha || github.event.before }}`,
  HEAD: `\${{ github.event.pull_request.head.sha || github.sha }}`,
  EVENT: `\${{ github.event_name }}`,
};

// Chromium's OS packages come from apt, so the step first finds a mirror that answers (apt.sh).
const chromium =
  "sudo sh .github/ci/apt.sh update\n" + "pnpm --filter @kampus/fabrika exec playwright install --with-deps chromium\n";

const forced = ["apps/fabrika/src/bundles.test.ts", "packages/pipeline/src/laws/standard.test.ts"];

export const lintWorkflow = (text: string): string[] => {
  let source: unknown;

  try {
    source = parse(text);
  } catch {
    return ["check.yaml: invalid YAML"];
  }

  const workflow = map(source),
    on = map(workflow["on"]),
    jobs = map(workflow["jobs"]);
  const errors: string[] = [];
  const require = (holds: boolean, reason: string) => {
    if (!holds) {
      errors.push(`check.yaml: ${reason}`);
    }
  };
  const push = map(on["push"]),
    pr = map(on["pull_request"]);
  require("pull_request" in on &&
    "push" in on &&
    JSON.stringify(push["branches"]) === '["main"]', "run every PR and main push");

  for (const trigger of [on, push, pr]) {
    require(!["paths", "paths-ignore", "branches-ignore", "tags", "tags-ignore"].some(
      (key) => key in trigger,
    ), "no workflow path or branch exclusions");
  }

  require(!("branches" in pr), "all PR bases remain enabled");

  for (const name of gated) {
    const job = map(jobs[name]);
    const needs = job["needs"];
    require(needs === "changes" ||
      (Array.isArray(needs) && needs.length === 1 && needs[0] === "changes"), `${name} needs changes`);
    require(compact(job["if"]) ===
      compact(
        `!cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.${name} != 'false')`,
      ), `${name} must run after classifier failure and skip only its false flag`);
  }

  // A job with no limit runs for GitHub's 360 minute default when a step hangs (ticket 496).
  for (const [name, job] of Object.entries(jobs)) {
    const limit = map(job)["timeout-minutes"];
    require(typeof limit === "number" && limit > 0 && limit < 360, `${name} sets timeout-minutes`);
  }

  // The one required check: it waits on every other job, never skips, and judges them all.
  const summary = map(jobs["ci-required"]),
    others = Object.keys(jobs).filter((name) => name !== "ci-required");
  const needed = Array.isArray(summary["needs"]) ? summary["needs"] : [];
  require(needed.length === others.length &&
    others.every((name) => needed.includes(name)), "ci-required needs every other job");
  require(compact(summary["if"]) === "always()" &&
    summary["continue-on-error"] === undefined, "ci-required runs after any result and its failure blocks");
  const judged = steps(summary).filter((s) => "run" in s);
  require(judged.length === 1 &&
    judged[0]?.["run"] === "node .github/ci/required.mjs" &&
    compact(map(judged[0]?.["env"])["NEEDS"]) === "toJSON(needs)" &&
    !("if" in (judged[0] ?? {})) &&
    judged[0]?.["continue-on-error"] === undefined, "ci-required judges toJSON(needs) with required.mjs");

  const changes = map(jobs["changes"]),
    outputs = map(changes["outputs"]);
  require(!("if" in changes) && !("needs" in changes), "changes starts on every event");

  for (const name of ["check", "test", "next", "e2e", "field"]) {
    require(compact(outputs[name]) === `steps.diff.outputs.${name}`, `changes exposes ${name}`);
  }

  require(commands(changes).includes("sh .agents/skills/lead/scripts/skillscheck.sh"), "changes runs the skills check");
  require(commands(changes).includes(
    "node oxlint-plugins/gitignore.mjs",
  ), "changes runs the shared tracked-file check");

  for (const command of ["sh .agents/skills/lead/scripts/skillscheck.sh", "node oxlint-plugins/gitignore.mjs"]) {
    require(steps(changes).some(
      (s) => s["run"] === command && compact(s["if"]) === "!cancelled()",
    ), "small scans still run after classifier failure");
  }

  const field = map(jobs["field"]);
  require(!("needs" in field) && !("if" in field), "field starts independently on every event");
  require(field["continue-on-error"] !== true, "field failures block");

  for (const [name, job] of [
    ["changes", changes],
    ["field", field],
  ] as const) {
    const list = steps(job);
    require(list.some(
      (s) =>
        typeof s["uses"] === "string" &&
        s["uses"].startsWith("actions/checkout@") &&
        map(s["with"])["fetch-depth"] === 0 &&
        !("if" in s),
    ), `${name} checks out history`);
    const diff = list.find((s) => s["id"] === "diff");
    require(diff?.["run"] === "node .github/ci/changes.mjs" && !("if" in (diff ?? {})), `${name} calls the classifier`);

    for (const [key, expected] of Object.entries(env)) {
      require(map(diff?.["env"])[key] === expected, `${name} passes event ${key} through env`);
    }
  }

  const fieldSteps = steps(field),
    flag = compact("steps.diff.outputs.field == 'true'");
  const install = fieldSteps.find((s) => typeof s["run"] === "string" && s["run"].startsWith("pnpm install "));
  require(typeof install?.["run"] === "string" &&
    install["run"].includes("--frozen-lockfile") &&
    install["run"].includes("--filter @tea-fabrika/ci") &&
    !install["run"].includes("--ignore-workspace"), "field installs the workspace package with its frozen lockfile");
  const check = fieldSteps.find((s) => s["run"] === "node .github/ci/field-check.ts");
  require(check !== undefined, "field runs the row checker");
  require(check?.["continue-on-error"] !== true, "row checker failures block");

  for (const action of ["pnpm/action-setup@", "actions/setup-node@"]) {
    require(fieldSteps.some(
      (s) => typeof s["uses"] === "string" && s["uses"].startsWith(action),
    ), `field includes ${action} setup`);
  }

  for (const [key, expected] of Object.entries(env)) {
    require(map(check?.["env"])[key] === expected, `field check passes ${key} through env`);
  }

  for (const step of fieldSteps.filter(
    (s) =>
      s === install ||
      s === check ||
      (typeof s["uses"] === "string" && /^(pnpm\/action-setup|actions\/setup-node)@/.test(s["uses"])),
  )) {
    require(compact(step["if"]) === flag, "field setup, install and validation skip without changed JSONL");
  }

  const test = map(jobs["test"]),
    scripts = commands(test);
  require(JSON.stringify(map(map(test["strategy"])["matrix"])["shard"]) === "[1,2,3,4,5,6]", "keep six shards");
  const runs = scripts.filter((line) => line.startsWith("pnpm exec vitest run"));
  require(runs.length === 5, "today has five test commands, including two lane commands");
  const testSteps = steps(test);
  const lane = testSteps.find((s) => s["name"] === "lane tests, one file at a time");
  const rest = testSteps.find((s) => s["name"] === "test");
  const times = testSteps.find((s) => s["name"] === "shard times");
  const laneRuns = commands({ steps: [lane] }).filter((line) => line.startsWith("pnpm exec vitest run"));
  const restRuns = commands({ steps: [rest] }).filter((line) => line.startsWith("pnpm exec vitest run"));
  require(restRuns.length === 3 &&
    restRuns.every((line) => line.includes(`--exclude '${LANE_GLOB}'`)), "L1: every rest command excludes lane files");
  require(laneRuns.length === 2 &&
    laneRuns.every(
      (line) =>
        line.startsWith(`pnpm exec vitest run ${LANE_FILTER} `) &&
        line.includes('--shard "$SHARD"') &&
        /--maxWorkers=1(?:\s|$)/.test(line) &&
        line.includes("--passWithNoTests") &&
        line.includes("--exclude 'next/**'"),
    ) &&
    laneRuns.filter((line) => line.includes('--changed "$BASE"')).length ===
      1, "L2: lane commands run one file at a time on PR and main");
  require(lane !== undefined &&
    rest !== undefined &&
    times !== undefined &&
    testSteps.indexOf(lane) < testSteps.indexOf(rest) &&
    testSteps.indexOf(rest) < testSteps.indexOf(times) &&
    compact(rest["if"]) === "!cancelled()" &&
    compact(times["if"]) === "!cancelled()", "L3: lanes first; rest and shard times survive failure");
  require(testFiles.some(inLaneStep), "L4: lane filter matches a real test file");

  for (const line of runs) {
    require(/--exclude\s+['"]next\/\*\*['"](?:\s|$)/.test(line), "every today command excludes next/**");
  }

  const changed = restRuns.find((line) => line.includes("--changed"));
  require(changed !== undefined &&
    changed.includes('--changed "$BASE"') &&
    changed.includes('--shard "$SHARD"') &&
    forced.every((path) => changed.includes(`--exclude ${path}`)), "changed shards exclude the two forced files");
  require(runs.some(
    (line) => !line.includes("--changed") && line.includes('--shard "$SHARD"'),
  ), "main keeps its full shard command");
  const forcedLine = scripts.findIndex(
    (line) =>
      line.startsWith("pnpm exec vitest run") &&
      forced.every((path) => line.includes(path)) &&
      !line.includes("--changed"),
  );
  require(forcedLine > 0 &&
    scripts[forcedLine - 1] === `if [ "\${{ matrix.shard }}" = 1 ]; then`, "forced tests run once on shard 1");
  require(scripts.includes('if [ -n "$BASE" ]; then') &&
    scripts.includes("else"), "PR and main branches remain separate");
  const nextJob = map(jobs["next"]),
    strategy = map(nextJob["strategy"]),
    matrix = map(strategy["matrix"]),
    nextSteps = steps(nextJob);
  require(!("name" in nextJob), "next keeps the default matrix check names");
  require(JSON.stringify(matrix["shard"]) === "[1,2,3,4,5,6]" &&
    Object.keys(matrix).length === 1, "next has exactly six shards and no other matrix entries");
  require(strategy["fail-fast"] === false, "next lets every shard finish");
  // Only these whole scripts are allowed; shell aliases and alternate paths cannot add work.
  const allowed = [
    "pnpm install --frozen-lockfile",
    'pnpm exec vitest run next/ --shard "$SHARD"',
    chromium,
    "node next/apps/fabrika/e2e.ts",
    'node next/apps/fabrika/src/exam/edges.ts --base "$BASE"',
  ];
  const nextRuns = nextSteps.filter((s) => "run" in s).map((s) => s["run"]);
  require(nextRuns.length === allowed.length &&
    allowed.every(
      (command) => nextRuns.filter((run) => run === command).length === 1,
    ), "next runs exactly its install and four approved commands once each");
  const testStep = nextSteps.find((s) => s["run"] === 'pnpm exec vitest run next/ --shard "$SHARD"');
  require(testStep !== undefined, "next runs all its own tests with --shard and no exclusions");
  const shard = map(testStep?.["env"])["SHARD"];
  require(testStep !== undefined &&
    !("if" in testStep) &&
    typeof shard === "string" &&
    /^\$\{\{\s*matrix\.shard\s*\}\}\/6$/.test(
      shard,
    ), "next passes its six-shard expression without an extra test guard");

  for (const [command, condition] of [
    [chromium, "matrix.shard == 1 && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''"],
    ["node next/apps/fabrika/e2e.ts", "matrix.shard == 1"],
    [
      'node next/apps/fabrika/src/exam/edges.ts --base "$BASE"',
      "matrix.shard == 1 && github.event_name == 'pull_request'",
    ],
  ] as const) {
    const matches = nextSteps.filter((s) => s["run"] === command);
    require(matches.length === 1 &&
      compact(matches[0]?.["if"]) ===
        compact(condition), `next runs ${command} once on shard 1 with its original condition`);
  }

  return errors;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    const errors = lintWorkflow(read(".github/workflows/check.yaml"));

    // T342 deliberately leaves this trusted workflow byte-for-byte unchanged.
    if (
      createHash("sha256").update(read(".github/workflows/commits.yaml")).digest("hex") !==
      "d660f6bb68243e6a48ab28f0872b36b9611c39ec5c060c9ba9cfae6776c698b1"
    ) {
      errors.push("commits.yaml changed; review its trusted workflow separately");
    }

    const manifest: unknown = JSON.parse(read("package.json"));

    if (!String(map(map(manifest)["scripts"])["lint"]).includes("node .github/ci/workflow-lint.ts")) {
      errors.push("pnpm lint must run workflow-lint.ts");
    }

    if (!read("oxlint-plugins/lint.ts").includes('import { checkTracked } from "./gitignore.mjs"')) {
      errors.push("full lint must use the shared tracked-file check");
    }

    if (existsSync(new URL("./pnpm-lock.yaml", import.meta.url))) {
      errors.push("CI uses the workspace lockfile, never a second one");
    }

    for (const error of errors) {
      console.error(error);
    }

    console.log(`workflow-lint: ${errors.length} errors`);
    process.exitCode = errors.length === 0 ? 0 : 1;
  } catch {
    console.error("workflow-lint: input could not be read");
    process.exitCode = 2;
  }
}
