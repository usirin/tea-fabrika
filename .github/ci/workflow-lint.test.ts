import { readFileSync, globSync } from "node:fs";
import { matchesGlob } from "node:path";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { lintWorkflow as lint, LANE_FILTER, LANE_GLOB, inLaneStep } from "./workflow-lint.ts";

// Today's CI for both versions. Covers workflow-lint.ts. Each generated valid workflow
// also receives every listed plant, one at a time, so an unrelated error cannot mask it.
// T342: all 24 input plants were rejected in each of 100 generated workflows.
// A source plant ignoring next's required job condition failed this property too.
const options = { seed: 119120, numRuns: 100 };

const guard = (job: string) =>
  `\${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.${job} != 'false') }}`;

const env = {
  BASE: `\${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before }}`,
  HEAD: `\${{ github.event.pull_request.head.sha || github.sha }}`,
  EVENT: `\${{ github.event_name }}`,
};

const diff = {
  id: "diff",
  env: { ...env, DRAFT: `\${{ github.event.pull_request.draft }}` },
  run: "node .github/ci/changes.mjs",
};

const build = `\${{ needs.changes.outputs.build != 'false' }}`;

const testEnv = {
  BASE: `\${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || (github.event.before != '0000000000000000000000000000000000000000' && github.event.before) || '' }}`,
};

const toolingExcludes = "--exclude 'next/**' --exclude 'apps/**' --exclude 'packages/**' --exclude 'programs/**'";
const fieldIf = "steps.diff.outputs.field == 'true'";
const probe = "steps.diff.outputs.probe == 'true'";
const name = fc.string({ maxLength: 20 });

const valid = (label: string, extra: string) => ({
  name: label,
  on: {
    push: { branches: ["main"] },
    pull_request: { types: ["opened", "synchronize", "reopened", "ready_for_review"] },
    merge_group: { types: ["checks_requested"] },
  },
  concurrency: {
    group: `check-\${{ github.event.pull_request.number || github.sha }}`,
    "cancel-in-progress": `\${{ github.event_name == 'pull_request' && github.event.action == 'synchronize' }}`,
  },
  jobs: {
    changes: {
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 5,
      outputs: {
        ...Object.fromEntries(
          ["check", "typecheck", "test", "e2e", "field", "build", "today"].map((key) => [
            key,
            `\${{ steps.diff.outputs.${key} }}`,
          ]),
        ),
        // The plan for CI paths, slice 2: the parser's pass prints these two again.
        next: `\${{ steps.same.outputs.next || steps.diff.outputs.next }}`,
        filter: `\${{ steps.same.outputs.filter || steps.diff.outputs.filter }}`,
      } as Record<string, string>,
      steps: [
        { uses: "actions/checkout@v7", with: { "fetch-depth": 0 } },
        diff,
        { run: "sh .agents/skills/lead/scripts/skillscheck.sh", if: "!cancelled()" },
        { run: "node oxlint-plugins/gitignore.mjs", if: "!cancelled()" },
        { name: extra, run: "echo checked" },
        // The parser's setup and pass, only when every changed line looks like a comment.
        { uses: "pnpm/action-setup@v6", if: probe, "continue-on-error": true, with: { run_install: false } },
        {
          uses: "actions/setup-node@v7",
          if: probe,
          "continue-on-error": true,
          with: { "node-version": "26.13.0" },
        },
        {
          run: "pnpm install --frozen-lockfile --filter @tea-fabrika/ci --ignore-scripts",
          if: probe,
          "continue-on-error": true,
        },
        { ...diff, id: "same", if: probe, "continue-on-error": true, run: "node .github/ci/changes.mjs --same" },
      ] as Record<string, unknown>[],
    },
    check: {
      name: `\${{ github.event.pull_request.draft && 'lint' || 'check' }}`,
      needs: "changes",
      if: guard("check"),
      "timeout-minutes": 10,
      steps: [
        { run: "pnpm lint" },
        { name: "promises", if: build, run: "pnpm promises gate" },
        { run: "pnpm build", if: build },
      ] as Record<string, unknown>[],
    },
    typecheck: {
      needs: "changes",
      if: guard("typecheck"),
      "timeout-minutes": 10,
      steps: [{ run: "pnpm install --frozen-lockfile" }, { run: "pnpm typecheck" }],
    },
    test: {
      needs: "changes",
      if: guard("test"),
      "timeout-minutes": 30,
      strategy: { matrix: { shard: [1, 2, 3, 4, 5, 6] } },
      steps: [
        {
          name: "test",
          if: `\${{ !cancelled() && needs.changes.outputs.today != 'false' }}`,
          env: testEnv,
          run: [
            'if [ -n "$BASE" ]; then',
            'pnpm exec vitest run --changed "$BASE" --shard "$SHARD" --passWithNoTests --exclude \'next/**\' --exclude apps/fabrika/src/bundles.test.ts --exclude packages/pipeline/src/laws/standard.test.ts',
            `if [ "\${{ matrix.shard }}" = 1 ]; then`,
            "pnpm exec vitest run apps/fabrika/src/bundles.test.ts packages/pipeline/src/laws/standard.test.ts --exclude 'next/**'",
            "fi",
            "else",
            "pnpm exec vitest run --shard \"$SHARD\" --exclude 'next/**'",
            "fi",
          ]
            .map((line) => (line.startsWith("pnpm exec vitest run") ? `${line} --exclude '${LANE_GLOB}'` : line))
            .join("\n"),
        },
        {
          name: "tooling tests",
          if: `\${{ !cancelled() && needs.changes.outputs.today == 'false' }}`,
          env: testEnv,
          run: [
            'if [ -n "$BASE" ]; then',
            `pnpm exec vitest run --changed "$BASE" --shard "$SHARD" --passWithNoTests ${toolingExcludes}`,
            "else",
            `pnpm exec vitest run --shard "$SHARD" --passWithNoTests ${toolingExcludes}`,
            "fi",
          ].join("\n"),
        },
      ],
    },
    next: {
      needs: "changes",
      if: guard("next"),
      "timeout-minutes": 17,
      strategy: { "fail-fast": false, matrix: { shard: [1, 2, 3, 4, 5, 6] } },
      steps: [
        {
          run: 'pnpm exec vitest run $FILTER --shard "$SHARD" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"',
          env: { SHARD: `\${{ matrix.shard }}/6`, FILTER: `\${{ needs.changes.outputs.filter || 'next/' }}` },
        },
        {
          name: "chromium",
          if: "matrix.shard == 1 && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''",
          run:
            "sudo sh .github/ci/apt.sh update\n" +
            "pnpm --filter @kampus/fabrika exec playwright install --with-deps chromium\n",
        },
        { run: "node next/apps/fabrika/e2e.ts", if: "matrix.shard == 1" },
        {
          name: "edges",
          if: "matrix.shard == 1 && github.event_name == 'pull_request'",
          env: { BASE: `\${{ github.event.pull_request.base.sha }}` },
          run: 'node next/apps/fabrika/src/exam/edges.ts --base "$BASE"',
        },
        { run: "pnpm install --frozen-lockfile" },
        { name: "shard times", if: "!cancelled()", run: 'node .github/ci/shard-times.ts "$RUNNER_TEMP/next.json"' },
      ],
    },
    e2e: {
      needs: "changes",
      if: guard("e2e"),
      "timeout-minutes": 25,
      steps: [{ run: "pnpm --filter @kampus/fabrika-app-old e2e" }],
    },
    field: {
      "timeout-minutes": 5,
      steps: [
        { uses: "actions/checkout@v7", with: { "fetch-depth": 0 } },
        diff,
        { uses: "pnpm/action-setup@v6", if: fieldIf },
        { uses: "actions/setup-node@v7", if: fieldIf, with: { "node-version": "26.13.0" } },
        {
          run: "pnpm install --frozen-lockfile --filter @tea-fabrika/ci --ignore-scripts",
          if: fieldIf,
        },
        { run: "node .github/ci/field-check.ts", if: fieldIf, env },
      ],
    },
    "ci-required": {
      name: `\${{ github.event.pull_request.draft && 'ci-required (draft)' || 'ci-required' }}`,
      needs: ["changes", "field", "check", "typecheck", "e2e", "test", "next"],
      if: "always()",
      "timeout-minutes": 5,
      steps: [
        { uses: "actions/checkout@v7", with: { "sparse-checkout": ".github/ci" } },
        { env: { NEEDS: `\${{ toJSON(needs) }}` }, run: "node .github/ci/required.mjs" },
      ] as Record<string, unknown>[],
    },
  },
});

type Workflow = ReturnType<typeof valid>;

const wiring = fc
  .tuple(name, name, fc.boolean(), fc.constantFrom("", " ", "  ", "\t", "\n"))
  .map(([label, extra, whitespace, gap]) => {
    const clean = valid(label, extra);
    clean.jobs.test.steps.unshift({
      name: "lane tests, one file at a time",
      if: `\${{ needs.changes.outputs.today != 'false' }}`,
      env: testEnv,
      run: [
        'if [ -n "$BASE" ]; then',
        `pnpm exec vitest run ${LANE_FILTER} --changed "$BASE" --shard "$SHARD" --maxWorkers=1 --passWithNoTests --exclude 'next/**'`,
        "else",
        `pnpm exec vitest run ${LANE_FILTER} --shard "$SHARD" --maxWorkers=1 --passWithNoTests --exclude 'next/**'`,
        "fi",
      ].join("\n"),
    });
    clean.jobs.test.steps.push({
      name: "shard times",
      if: "!cancelled()",
      env: testEnv,
      run: "node .github/ci/shard-times.ts",
    });

    if (whitespace) {
      clean.jobs.next.steps[0]!.env!.SHARD = `\${{${gap}matrix.shard${gap}}}/6`;

      for (const step of clean.jobs.next.steps.slice(1, 4)) {
        step.if = `\${{${gap}${step.if?.replace(/ *(==|!=|&&) */g, `${gap}$1${gap}`)}${gap}}}`;
      }

      clean.jobs.next.steps[5]!.if = `\${{${gap}!cancelled()${gap}}}`;
    }

    return clean;
  });

// Pinned T376 second-review bypasses, also applied to every generated valid workflow.
const extraCommands = [
  { run: "pnpm test next/" },
  { run: "pnpm run test" },
  { run: 'pnpm exec vi""test run next/' },
  { run: "cd next/apps/fabrika && node e2e.ts" },
  { run: "node e2e.ts", "working-directory": "next/apps/fabrika" },
  { run: "pnpm --filter @kampus/fabrika exec node e2e.ts" },
  { run: 'node next/apps/fabrika/src/exam/../exam/edges.ts --base "$BASE"' },
  { run: 'cd next/apps/fabrika/src/exam && node edges.ts --base "$BASE"' },
  { run: "npx playwright@latest install chromium" },
  { run: "pnpm --filter @kampus/fabrika exec playwright -- install chromium" },
];

it.each(extraCommands)("pinned: T376 review extra command in real workflow: $run", (step) => {
  const workflow = parse(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"));
  expect(lint(JSON.stringify(workflow))).toEqual([]);
  workflow.jobs.next.steps.push(step);
  expect(lint(JSON.stringify(workflow))).not.toEqual([]);
});

const plants: [string, (workflow: Workflow) => void][] = [
  // 0134's amendment (2026-11-11): a draft runs the fast jobs, and marking it ready runs the rest.
  ...["opened", "synchronize", "reopened", "ready_for_review"].map((type): [string, (w: Workflow) => void] => [
    `pull requests lose the ${type} trigger`,
    (w) => {
      w.on.pull_request.types = w.on.pull_request.types.filter((t) => t !== type);
    },
  ]),
  [
    "the merge queue's group stops running the checks",
    (w) => {
      delete (w.on as Record<string, unknown>)["merge_group"];
    },
  ],
  [
    "every pull request event cancels the run before it",
    (w) => {
      w.concurrency["cancel-in-progress"] = `\${{ github.event_name == 'pull_request' }}`;
    },
  ],
  [
    "a draft's check keeps the name check",
    (w) => {
      w.jobs.check.name = "check";
    },
  ],
  [
    "a draft's ci-required keeps the name ci-required",
    (w) => {
      w.jobs["ci-required"].name = "ci-required";
    },
  ],
  [
    "the build runs on a draft",
    (w) => {
      delete w.jobs.check.steps[2]!["if"];
    },
  ],
  [
    "the promises gate skips on the check flag",
    (w) => {
      w.jobs.check.steps[1]!["if"] = `\${{ needs.changes.outputs.check != 'false' }}`;
    },
  ],
  [
    "lint skips on a draft",
    (w) => {
      w.jobs.check.steps[0]!["if"] = build;
    },
  ],
  [
    "changes hides the build flag",
    (w) => {
      delete (w.jobs.changes.outputs as Record<string, string>)["build"];
    },
  ],
  [
    "the classifier is not told the draft",
    (w) => {
      for (const step of [w.jobs.changes.steps[1]!, w.jobs.field.steps[1]!]) {
        Object.assign(step, { env });
      }
    },
  ],
  [
    "L1: main loses lane exclude",
    (w) => {
      const step = w.jobs.test.steps[1]!;
      const lines = step.run.split("\n");
      lines[6] = lines[6]!.replace(` --exclude '${LANE_GLOB}'`, "");
      step.run = lines.join("\n");
    },
  ],
  [
    "L2: two lane workers",
    (w) => {
      w.jobs.test.steps[0]!.run = w.jobs.test.steps[0]!.run.replace("--maxWorkers=1", "--maxWorkers=2");
    },
  ],
  [
    "L3: failure skips rest",
    (w) => {
      w.jobs.test.steps[1]!.if = "";
    },
  ],
  [
    "L3: rest before lanes",
    (w) => {
      w.jobs.test.steps.reverse();
    },
  ],
  [
    "L3: failure skips advice",
    (w) => {
      w.jobs.test.steps[3]!.if = "";
    },
  ],
  // 0175: today's tests start only on the today flag, and the tooling tests run when they do not.
  [
    "T1: the lane tests run with no file of today's version changed",
    (w) => {
      w.jobs.test.steps[0]!.if = "";
    },
  ],
  [
    "T1: today's tests run with no file of today's version changed",
    (w) => {
      w.jobs.test.steps[1]!.if = "!cancelled()";
    },
  ],
  [
    "T2: the tooling tests are gone",
    (w) => {
      w.jobs.test.steps.splice(2, 1);
    },
  ],
  [
    "T2: the tooling tests run beside today's",
    (w) => {
      w.jobs.test.steps[2]!.if = "!cancelled()";
    },
  ],
  [
    "T3: the tooling tests run today's packages' tests",
    (w) => {
      w.jobs.test.steps[2]!.run = w.jobs.test.steps[2]!.run.replace(" --exclude 'packages/**'", "");
    },
  ],
  ...[0, 1, 2].map((index): [string, (w: Workflow) => void] => [
    `T4: test step ${index} reads its base from a pull request alone`,
    (w) => {
      w.jobs.test.steps[index]!.env = { BASE: `\${{ github.event.pull_request.base.sha }}` };
    },
  ]),
  [
    "changes hides the today flag",
    (w) => {
      delete (w.jobs.changes.outputs as Record<string, string>)["today"];
    },
  ],
  [
    "L4: nonexistent lane filter",
    (w) => {
      w.jobs.test.steps[0]!.run = w.jobs.test.steps[0]!.run.replaceAll(LANE_FILTER, "missing/lane.");
    },
  ],
  ...extraCommands.map((step): [string, (w: Workflow) => void] => [
    `review2 extra command: ${step.run}`,
    (w) => {
      w.jobs.next.steps.push(step);
    },
  ]),
  ...["missing", "duplicate"].map((fault): [string, (w: Workflow) => void] => [
    `next ${fault} install`,
    (w) => {
      if (fault === "missing") {
        w.jobs.next.steps.splice(4, 1);
      } else {
        w.jobs.next.steps.push({ ...w.jobs.next.steps[4]! });
      }
    },
  ]),
  [
    "review: extra exec Vitest invocation",
    (w) => {
      w.jobs.next.steps.push({ ...w.jobs.next.steps[0]!, run: `exec ${w.jobs.next.steps[0]!.run}` });
    },
  ],
  ...[
    "vitest run next/",
    "pnpm vitest run next/",
    "npx vitest run next/",
    "./node_modules/.bin/vitest run next/",
    'pnpm exec "vitest" run next/',
    'env CI=true pnpm exec vitest run next/ --shard "$SHARD"',
    'echo before; pnpm exec vitest run next/ --shard "$SHARD"; echo after',
    'echo before\npnpm exec vitest run next/ --shard "$SHARD"\necho after',
    "pnpm exec vitest run next/; pnpm exec vitest run next/",
  ].map((run): [string, (w: Workflow) => void] => [
    `extra Vitest spelling: ${run}`,
    (w) => {
      w.jobs.next.steps.push({ ...w.jobs.next.steps[0]!, run });
    },
  ]),
  ...[1, 2, 3].map((index): [string, (w: Workflow) => void] => [
    `review: extra multiline ${["", "Chromium", "e2e", "edges"][index]} invocation`,
    (w) => {
      w.jobs.next.steps.push({
        ...w.jobs.next.steps[index]!,
        run: `echo before\n${w.jobs.next.steps[index]!.run}\necho after`,
      });
    },
  ]),
  [
    "review: SHARD matrix.sha rd",
    (w) => {
      w.jobs.next.steps[0]!.env!.SHARD = `\${{ matrix.sha rd }}/6`;
    },
  ],
  ...[1, 2, 3].map((index): [string, (w: Workflow) => void] => [
    `review: ${["", "Chromium", "e2e", "edges"][index]} guard matrix.sha rd`,
    (w) => {
      w.jobs.next.steps[index]!.if = w.jobs.next.steps[index]!.if!.replace("matrix.shard", "matrix.sha rd");
    },
  ]),
  [
    "review: Chromium path next/ apps",
    (w) => {
      w.jobs.next.steps[1]!.if = w.jobs.next.steps[1]!.if!.replace("next/apps", "next/ apps");
    },
  ],
  [
    "review: edges event pull_ request",
    (w) => {
      w.jobs.next.steps[3]!.if = w.jobs.next.steps[3]!.if!.replace("pull_request", "pull_ request");
    },
  ],
  [
    "next missing shard",
    (w) => {
      w.jobs.next.strategy.matrix.shard.pop();
    },
  ],
  [
    "next wrong denominator",
    (w) => {
      w.jobs.next.steps[0]!.env!.SHARD = `\${{ matrix.shard }}/3`;
    },
  ],
  [
    "next fail fast",
    (w) => {
      w.jobs.next.strategy["fail-fast"] = true;
    },
  ],
  [
    "next extra axis",
    (w) => {
      Object.assign(w.jobs.next.strategy.matrix, { os: ["ubuntu"] });
    },
  ],
  [
    "next include",
    (w) => {
      Object.assign(w.jobs.next.strategy.matrix, { include: [{ shard: 7 }] });
    },
  ],
  [
    "next exclude",
    (w) => {
      Object.assign(w.jobs.next.strategy.matrix, { exclude: [{ shard: 6 }] });
    },
  ],
  [
    "next custom name",
    (w) => {
      Object.assign(w.jobs.next, { name: "next" });
    },
  ],
  [
    "next duplicate command",
    (w) => {
      w.jobs.next.steps.push({ ...w.jobs.next.steps[0]! });
    },
  ],
  ...[
    " --reporter=verbose",
    " --reporter=json",
    " --reporter=github-actions",
    ' --outputFile.json="$RUNNER_TEMP/next.json"',
  ].map((flag): [string, (w: Workflow) => void] => [
    `next loses ${flag}`,
    (w) => {
      const step = w.jobs.next.steps[0]!;
      step.run = step.run.replace(flag, "");
    },
  ]),
  ...["missing", "duplicate", "before tests", "wrong report"].map((fault): [string, (w: Workflow) => void] => [
    `next timing advice ${fault}`,
    (w) => {
      const advice = w.jobs.next.steps[5]!;

      if (fault === "missing") {
        w.jobs.next.steps.splice(5, 1);
      } else if (fault === "duplicate") {
        w.jobs.next.steps.push({ ...advice });
      } else if (fault === "before tests") {
        w.jobs.next.steps.splice(5, 1);
        w.jobs.next.steps.unshift(advice);
      } else {
        advice.run = 'node .github/ci/shard-times.ts "$RUNNER_TEMP/other.json"';
      }
    },
  ]),
  ...["", "success()", "always()", "false", "matrix.shard == 1 && !cancelled()"].map(
    (condition): [string, (w: Workflow) => void] => [
      `next timing advice condition ${condition || "absent"}`,
      (w) => {
        w.jobs.next.steps[5]!.if = condition;
      },
    ],
  ),
  ...[" --changed main", " --passWithNoTests", " file.test.ts"].map((suffix): [string, (w: Workflow) => void] => [
    suffix,
    (w) => {
      w.jobs.next.steps[0]!.run += suffix;
    },
  ]),
  [
    "next test command inside a longer step",
    (w) => {
      w.jobs.next.steps[0]!.run = `echo before\n${w.jobs.next.steps[0]!.run}`;
    },
  ],
  [
    "next no shard flag",
    (w) => {
      w.jobs.next.steps[0]!.run = "pnpm exec vitest run next/";
    },
  ],
  [
    "next guarded test",
    (w) => {
      Object.assign(w.jobs.next.steps[0]!, { if: "false" });
    },
  ],
  [
    "next classifier failure skips",
    (w) => {
      w.jobs.next.if = "needs.changes.outputs.next == 'true'";
    },
  ],
  ...[1, 2, 3].flatMap((index): [string, (w: Workflow) => void][] => [
    [
      `next missing step ${index}`,
      (w) => {
        w.jobs.next.steps.splice(index, 1);
      },
    ],
    [
      `next duplicate step ${index}`,
      (w) => {
        w.jobs.next.steps.push({ ...w.jobs.next.steps[index]! });
      },
    ],
    [
      `next false step ${index}`,
      (w) => {
        w.jobs.next.steps[index]!.if = "false";
      },
    ],
  ]),
  [
    "next e2e everywhere",
    (w) => {
      w.jobs.next.steps[2]!.if = "true";
    },
  ],
  [
    "next chromium without file guard",
    (w) => {
      w.jobs.next.steps[1]!.if = "matrix.shard == 1";
    },
  ],
  [
    "next edges without event guard",
    (w) => {
      w.jobs.next.steps[3]!.if = "matrix.shard == 1";
    },
  ],
  [
    "scan skips after failure",
    (w) => {
      Object.assign(w.jobs.changes.steps[2]!, { if: "success()" });
    },
  ],
  [
    "changes skips",
    (w) => {
      Object.assign(w.jobs.changes, { if: "false" });
    },
  ],
  [
    "field ignores failure",
    (w) => {
      Object.assign(w.jobs.field, { "continue-on-error": true });
    },
  ],
  [
    "checker ignores failure",
    (w) => {
      Object.assign(w.jobs.field.steps[5]!, { "continue-on-error": true });
    },
  ],
  [
    "missing field setup",
    (w) => {
      w.jobs.field.steps.splice(2, 1);
    },
  ],
  [
    "unconditional check",
    (w) => {
      w.jobs.check.if = "true";
    },
  ],
  [
    "missing next condition",
    (w) => {
      w.jobs.next.if = "";
    },
  ],
  [
    "missing e2e dependency",
    (w) => {
      w.jobs.e2e.needs = "";
    },
  ],
  [
    "failure skips tests",
    (w) => {
      w.jobs.test.if = "needs.changes.outputs.test == 'true'";
    },
  ],
  [
    "classifier bypass",
    (w) => {
      Object.assign(w.jobs.changes.steps[1]!, { run: "echo check=false" });
    },
  ],
  [
    "missing skills scan",
    (w) => {
      w.jobs.changes.steps.splice(2, 1);
    },
  ],
  [
    "missing ignore scan",
    (w) => {
      w.jobs.changes.steps.splice(3, 1);
    },
  ],
  [
    "missing output",
    (w) => {
      delete w.jobs.changes.outputs["next"];
    },
  ],
  // The plan for CI paths, slice 2, law 21: the next job's path comes from filter with the fallback
  // next/, and the changes job's parser steps carry continue-on-error.
  [
    "next loses its path fallback",
    (w) => {
      w.jobs.next.steps[0]!.env!.FILTER = `\${{ needs.changes.outputs.filter }}`;
    },
  ],
  [
    "next runs all of next/ whatever filter says",
    (w) => {
      w.jobs.next.steps[0]!.run = w.jobs.next.steps[0]!.run.replace("$FILTER", "next/");
    },
  ],
  [
    "next quotes its path, so the reader paths are one argument",
    (w) => {
      w.jobs.next.steps[0]!.run = w.jobs.next.steps[0]!.run.replace("$FILTER", '"$FILTER"');
    },
  ],
  [
    "next has no filter",
    (w) => {
      delete (w.jobs.next.steps[0]!.env as Record<string, string>)["FILTER"];
    },
  ],
  ...(["next", "filter"] as const).flatMap((key): [string, (w: Workflow) => void][] => [
    [
      `changes exposes ${key} from the first pass alone`,
      (w) => {
        w.jobs.changes.outputs[key] = `\${{ steps.diff.outputs.${key} }}`;
      },
    ],
    [
      `changes exposes ${key} from the parser's pass alone`,
      (w) => {
        w.jobs.changes.outputs[key] = `\${{ steps.same.outputs.${key} }}`;
      },
    ],
    [
      `changes hides ${key}`,
      (w) => {
        delete w.jobs.changes.outputs[key];
      },
    ],
  ]),
  ...[5, 6, 7, 8].map((index): [string, (w: Workflow) => void] => [
    `the parser's step ${index} fails changes`,
    (w) => {
      delete w.jobs.changes.steps[index]!["continue-on-error"];
    },
  ]),
  [
    "the parser's pass is gone",
    (w) => {
      w.jobs.changes.steps.splice(8, 1);
    },
  ],
  [
    "the parser's install is gone",
    (w) => {
      w.jobs.changes.steps.splice(7, 1);
    },
  ],
  [
    "the parser's pass runs before its install",
    (w) => {
      w.jobs.changes.steps.splice(7, 0, w.jobs.changes.steps.splice(8, 1)[0]!);
    },
  ],
  [
    "the parser's pass is not told the draft",
    (w) => {
      w.jobs.changes.steps[8]!["env"] = env;
    },
  ],
  [
    "workflow path filter",
    (w) => {
      Object.assign(w.on, { pull_request: { paths: ["next/**"] } });
    },
  ],
  [
    "main filter",
    (w) => {
      w.on.push.branches = ["other"];
    },
  ],
  [
    "field waits",
    (w) => {
      Object.assign(w.jobs.field, { needs: "changes" });
    },
  ],
  [
    "field unconditional install",
    (w) => {
      Object.assign(w.jobs.field.steps[4]!, { if: "true" });
    },
  ],
  [
    "field bypass",
    (w) => {
      Object.assign(w.jobs.field.steps[5]!, { run: "echo passed" });
    },
  ],
  [
    "next job excludes next",
    (w) => {
      w.jobs.next.steps[0]!.run += " --exclude 'next/**'";
    },
  ],
  ...[0, 1, 2].map((branch): [string, (w: Workflow) => void] => [
    `exclusion branch ${branch}`,
    (w) => {
      const lines = w.jobs.test.steps[1]!.run.split("\n");
      const line = [1, 3, 6][branch]!;
      lines[line] = lines[line]!.replace(" --exclude 'next/**'", "");
      w.jobs.test.steps[1]!.run = lines.join("\n");
    },
  ]),
  // The ci-required job: it waits on every job, never skips, and its judge cannot be bypassed.
  ...(["changes", "field", "check", "typecheck", "test", "next", "e2e"] as const).map(
    (job): [string, (w: Workflow) => void] => [
      `ci-required does not need ${job}`,
      (w) => {
        w.jobs["ci-required"].needs = w.jobs["ci-required"].needs.filter((name) => name !== job);
      },
    ],
  ),
  // The lane reads the typecheck job's answer alone (0133), so the typecheck lives there only.
  [
    "the typecheck job runs no typecheck",
    (w) => {
      w.jobs.typecheck.steps = [{ run: "pnpm install --frozen-lockfile" }];
    },
  ],
  [
    "check runs the typecheck again",
    (w) => {
      w.jobs.check.steps.unshift({ run: "pnpm typecheck" });
    },
  ],
  [
    "a new job ci-required does not need",
    (w) => {
      Object.assign(w.jobs, { lint: { "timeout-minutes": 5, steps: [{ run: "pnpm lint" }] } });
    },
  ],
  ...["!cancelled()", "success()", ""].map((condition): [string, (w: Workflow) => void] => [
    `ci-required runs only on ${condition || "no condition"}`,
    (w) => {
      w.jobs["ci-required"].if = condition;
    },
  ]),
  [
    "ci-required ignores its failure",
    (w) => {
      Object.assign(w.jobs["ci-required"], { "continue-on-error": true });
    },
  ],
  [
    "ci-required judge ignores its failure",
    (w) => {
      Object.assign(w.jobs["ci-required"].steps[1]!, { "continue-on-error": true });
    },
  ],
  [
    "ci-required bypassed",
    (w) => {
      w.jobs["ci-required"].steps[1]!["run"] = "echo pass";
    },
  ],
  [
    "ci-required reads needs.*.result only",
    (w) => {
      w.jobs["ci-required"].steps[1]!["env"] = { NEEDS: `\${{ toJSON(needs.*.result) }}` };
    },
  ],
  [
    "ci-required second step",
    (w) => {
      w.jobs["ci-required"].steps.push({ run: "exit 0" });
    },
  ],
  // T496: a job with no time limit, one plant per job, and one limit past GitHub's default.
  ...(["changes", "field", "check", "typecheck", "test", "next", "e2e", "ci-required"] as const).map(
    (job): [string, (w: Workflow) => void] => [
      `${job} without a time limit`,
      (w) => {
        Object.assign(w.jobs[job], { "timeout-minutes": undefined });
      },
    ],
  ),
  [
    "a time limit past the default",
    (w) => {
      w.jobs.test["timeout-minutes"] = 360;
    },
  ],
  [
    "duplicate forced tests",
    (w) => {
      w.jobs.test.steps[1]!.run = w.jobs.test.steps[1]!.run.replace(" --exclude apps/fabrika/src/bundles.test.ts", "");
    },
  ],
  [
    "forced tests on all shards",
    (w) => {
      w.jobs.test.steps[1]!.run = w.jobs.test.steps[1]!.run.replace(
        `if [ "\${{ matrix.shard }}" = 1 ]; then`,
        "if true; then",
      );
    },
  ],
];

it("accepts generated valid wiring", () => {
  fc.assert(
    fc.property(wiring, (clean) => {
      expect(lint(JSON.stringify(clean))).toEqual([]);
    }),
    options,
  );
});

it.each(plants)("rejects isolated wiring plant: %s", (plant, mutate) => {
  fc.assert(
    fc.property(wiring, (clean) => {
      expect(lint(JSON.stringify(clean))).toEqual([]);
      const broken = structuredClone(clean);
      mutate(broken);
      expect(lint(JSON.stringify(broken)), plant).not.toEqual([]);
    }),
    options,
  );
});

it("names the next command whose step or condition is wrong", () => {
  fc.assert(
    fc.property(wiring, fc.constantFrom(1, 2, 3), fc.boolean(), (broken, index, missingGuard) => {
      const step = broken.jobs.next.steps[index]!;
      step.if = missingGuard ? (index === 2 ? "true" : "matrix.shard == 1") : "false";
      expect(lint(JSON.stringify(broken))).toEqual([
        `check.yaml: next runs ${step.run} once on shard 1 with its original condition`,
      ]);
    }),
    options,
  );
});

it("format: the checked-in workflow passes the same wiring lint", () => {
  // A fixed file read is a format check. Structural decisions live in the linter.
  expect(lint(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"))).toEqual([]);
});

it("L5: lane selection and rest exclusion agree on today's test paths", () => {
  // Vitest includes .test.ts only; next/ is excluded by both commands.
  // Plant: lane*.test.ts also excludes lane-fixture.test.ts.
  const real = globSync(["packages/**/*.test.ts", "apps/**/*.test.ts", ".github/**/*.test.ts"]);
  const made = fc
    .stringMatching(/^[a-z][a-z.-]{0,30}$/)
    .chain((name) =>
      fc.constantFrom(
        `${LANE_FILTER}${name}.test.ts`,
        `packages/pipeline/src/stages/pipeline/lane-${name}.test.ts`,
        `stages/lane/${name}.test.ts`,
        `packages/pipeline/src/stages/pipeline/${name}.test.ts`,
      ),
    );
  fc.assert(
    fc.property(fc.oneof(fc.constantFrom(...real), made), (path) => {
      expect(inLaneStep(path), path).toBe(matchesGlob(path, LANE_GLOB));
    }),
    {
      ...options,
      examples: [
        ["packages/pipeline/src/stages/pipeline/lane-fixture.test.ts"],
        [`${LANE_FILTER}x.y.test.ts`],
        ["stages/lane/lane.test.ts"],
      ],
    },
  );
});
