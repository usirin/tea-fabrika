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
  BASE: `\${{ github.event.pull_request.base.sha || github.event.before }}`,
  HEAD: `\${{ github.event.pull_request.head.sha || github.sha }}`,
  EVENT: `\${{ github.event_name }}`,
};

const diff = { id: "diff", env, run: "node .github/ci/changes.mjs" };
const fieldIf = "steps.diff.outputs.field == 'true'";
const name = fc.string({ maxLength: 20 });

const valid = (label: string, extra: string) => ({
  name: label,
  on: { push: { branches: ["main"] }, pull_request: null },
  jobs: {
    changes: {
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 5,
      outputs: Object.fromEntries(
        ["check", "test", "next", "e2e", "field"].map((key) => [key, `\${{ steps.diff.outputs.${key} }}`]),
      ),
      steps: [
        { uses: "actions/checkout@v7", with: { "fetch-depth": 0 } },
        diff,
        { run: "sh .agents/skills/lead/scripts/skillscheck.sh", if: "!cancelled()" },
        { run: "node oxlint-plugins/gitignore.mjs", if: "!cancelled()" },
        { name: extra, run: "echo checked" },
      ],
    },
    check: {
      needs: "changes",
      if: guard("check"),
      "timeout-minutes": 10,
      steps: [{ run: "pnpm typecheck" }, { run: "pnpm lint" }, { run: "pnpm build" }],
    },
    test: {
      needs: "changes",
      if: guard("test"),
      "timeout-minutes": 30,
      strategy: { matrix: { shard: [1, 2, 3, 4, 5, 6] } },
      steps: [
        {
          name: "test",
          if: "!cancelled()",
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
      ],
    },
    next: {
      needs: "changes",
      if: guard("next"),
      "timeout-minutes": 10,
      strategy: { "fail-fast": false, matrix: { shard: [1, 2, 3, 4, 5, 6] } },
      steps: [
        {
          run: 'pnpm exec vitest run next/ --shard "$SHARD"',
          env: { SHARD: `\${{ matrix.shard }}/6` },
        },
        {
          name: "chromium",
          if: "matrix.shard == 1 && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''",
          run: "pnpm --filter @kampus/fabrika exec playwright install --with-deps chromium",
        },
        { run: "node next/apps/fabrika/e2e.ts", if: "matrix.shard == 1" },
        {
          name: "edges",
          if: "matrix.shard == 1 && github.event_name == 'pull_request'",
          env: { BASE: `\${{ github.event.pull_request.base.sha }}` },
          run: 'node next/apps/fabrika/src/exam/edges.ts --base "$BASE"',
        },
        { run: "pnpm install --frozen-lockfile" },
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
  },
});

type Workflow = ReturnType<typeof valid>;

const wiring = fc
  .tuple(name, name, fc.boolean(), fc.constantFrom("", " ", "  ", "\t", "\n"))
  .map(([label, extra, whitespace, gap]) => {
    const clean = valid(label, extra);
    clean.jobs.test.steps.unshift({
      name: "lane tests, one file at a time",
      if: "",
      run: [
        'if [ -n "$BASE" ]; then',
        `pnpm exec vitest run ${LANE_FILTER} --changed "$BASE" --shard "$SHARD" --maxWorkers=1 --passWithNoTests --exclude 'next/**'`,
        "else",
        `pnpm exec vitest run ${LANE_FILTER} --shard "$SHARD" --maxWorkers=1 --passWithNoTests --exclude 'next/**'`,
        "fi",
      ].join("\n"),
    });
    clean.jobs.test.steps.push({ name: "shard times", if: "!cancelled()", run: "node .github/ci/shard-times.ts" });

    if (whitespace) {
      clean.jobs.next.steps[0]!.env!.SHARD = `\${{${gap}matrix.shard${gap}}}/6`;

      for (const step of clean.jobs.next.steps.slice(1, 4)) {
        step.if = `\${{${gap}${step.if?.replace(/ *(==|!=|&&) */g, `${gap}$1${gap}`)}${gap}}}`;
      }
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
      w.jobs.test.steps[2]!.if = "";
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
        w.jobs.next.steps.pop();
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
  // T496: a job with no time limit, one plant per job, and one limit past GitHub's default.
  ...(["changes", "field", "check", "test", "next", "e2e"] as const).map((job): [string, (w: Workflow) => void] => [
    `${job} without a time limit`,
    (w) => {
      Object.assign(w.jobs[job], { "timeout-minutes": undefined });
    },
  ]),
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
