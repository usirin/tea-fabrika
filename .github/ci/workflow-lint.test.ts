import {readFileSync} from "node:fs";
import * as fc from "fast-check";
import {expect, it} from "vitest";
import {lintWorkflow as lint} from "./workflow-lint.ts";

// Today's CI for both versions. Covers workflow-lint.ts. Each generated valid workflow
// also receives every listed plant, one at a time, so an unrelated error cannot mask it.
// T342: all 24 input plants were rejected in each of 100 generated workflows.
// A source plant ignoring next's required job condition failed this property too.
const options = {seed: 119120, numRuns: 100};

const guard = (job: string) =>
	`\${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.${job} != 'false') }}`;

const env = {
	BASE: `\${{ github.event.pull_request.base.sha || github.event.before }}`,
	HEAD: `\${{ github.event.pull_request.head.sha || github.sha }}`,
	EVENT: `\${{ github.event_name }}`,
};

const diff = {id: "diff", env, run: "node .github/ci/changes.mjs"};
const fieldIf = "steps.diff.outputs.field == 'true'";
const name = fc.string({maxLength: 20});

const valid = (label: string, extra: string) => ({
	name: label,
	on: {push: {branches: ["main"]}, pull_request: null},
	jobs: {
		changes: {
			"runs-on": "ubuntu-latest",
			outputs: Object.fromEntries(
				["check", "test", "next", "e2e", "field"].map((key) => [
					key,
					`\${{ steps.diff.outputs.${key} }}`,
				]),
			),
			steps: [
				{uses: "actions/checkout@v7", with: {"fetch-depth": 0}},
				diff,
				{run: "sh .agents/skills/lead/scripts/skillscheck.sh", if: "!cancelled()"},
				{run: "node oxlint-plugins/gitignore.mjs", if: "!cancelled()"},
				{name: extra, run: "echo checked"},
			],
		},
		check: {
			needs: "changes",
			if: guard("check"),
			steps: [{run: "pnpm typecheck"}, {run: "pnpm lint"}, {run: "pnpm build"}],
		},
		test: {
			needs: "changes",
			if: guard("test"),
			strategy: {matrix: {shard: [1, 2, 3, 4, 5, 6]}},
			steps: [
				{
					run: [
						'if [ -n "$BASE" ]; then',
						'pnpm exec vitest run --changed "$BASE" --shard "$SHARD" --passWithNoTests --exclude \'next/**\' --exclude apps/fabrika/src/bundles.test.ts --exclude packages/pipeline/src/laws/standard.test.ts',
						`if [ "\${{ matrix.shard }}" = 1 ]; then`,
						"pnpm exec vitest run apps/fabrika/src/bundles.test.ts packages/pipeline/src/laws/standard.test.ts --exclude 'next/**'",
						"fi",
						"else",
						"pnpm exec vitest run --shard \"$SHARD\" --exclude 'next/**'",
						"fi",
					].join("\n"),
				},
			],
		},
		next: {needs: "changes", if: guard("next"), steps: [{run: "pnpm exec vitest run next/"}]},
		e2e: {
			needs: "changes",
			if: guard("e2e"),
			steps: [{run: "pnpm --filter @kampus/fabrika-app-old e2e"}],
		},
		field: {
			steps: [
				{uses: "actions/checkout@v7", with: {"fetch-depth": 0}},
				diff,
				{uses: "pnpm/action-setup@v6", if: fieldIf},
				{uses: "actions/setup-node@v7", if: fieldIf, with: {"node-version": "26.13.0"}},
				{
					run: "pnpm install --frozen-lockfile --filter @tea-fabrika/ci --ignore-scripts",
					if: fieldIf,
				},
				{run: "node .github/ci/field-check.ts", if: fieldIf, env},
			],
		},
	},
});

type Workflow = ReturnType<typeof valid>;

const plants: [string, (workflow: Workflow) => void][] = [
	[
		"scan skips after failure",
		(w) => {
			Object.assign(w.jobs.changes.steps[2]!, {if: "success()"});
		},
	],
	[
		"changes skips",
		(w) => {
			Object.assign(w.jobs.changes, {if: "false"});
		},
	],
	[
		"field ignores failure",
		(w) => {
			Object.assign(w.jobs.field, {"continue-on-error": true});
		},
	],
	[
		"checker ignores failure",
		(w) => {
			Object.assign(w.jobs.field.steps[5]!, {"continue-on-error": true});
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
			Object.assign(w.jobs.changes.steps[1]!, {run: "echo check=false"});
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
			Object.assign(w.on, {pull_request: {paths: ["next/**"]}});
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
			Object.assign(w.jobs.field, {needs: "changes"});
		},
	],
	[
		"field unconditional install",
		(w) => {
			Object.assign(w.jobs.field.steps[4]!, {if: "true"});
		},
	],
	[
		"field bypass",
		(w) => {
			Object.assign(w.jobs.field.steps[5]!, {run: "echo passed"});
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
			const lines = w.jobs.test.steps[0]!.run.split("\n");
			const line = [1, 3, 6][branch]!;
			lines[line] = lines[line]!.replace(" --exclude 'next/**'", "");
			w.jobs.test.steps[0]!.run = lines.join("\n");
		},
	]),
	[
		"duplicate forced tests",
		(w) => {
			w.jobs.test.steps[0]!.run = w.jobs.test.steps[0]!.run.replace(
				" --exclude apps/fabrika/src/bundles.test.ts",
				"",
			);
		},
	],
	[
		"forced tests on all shards",
		(w) => {
			w.jobs.test.steps[0]!.run = w.jobs.test.steps[0]!.run.replace(
				`if [ "\${{ matrix.shard }}" = 1 ]; then`,
				"if true; then",
			);
		},
	],
];

it("accepts generated valid wiring and rejects every isolated wiring plant", () => {
	fc.assert(
		fc.property(name, name, (label, extra) => {
			const clean = valid(label, extra);
			expect(lint(JSON.stringify(clean))).toEqual([]);
			for (const [plant, mutate] of plants) {
				const broken = structuredClone(clean);
				mutate(broken);
				expect(lint(JSON.stringify(broken)), plant).not.toEqual([]);
			}
		}),
		options,
	);
});

it("format: the checked-in workflow passes the same wiring lint", () => {
	// A fixed file read is a format check. Structural decisions live in the linter.
	expect(lint(readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8"))).toEqual(
		[],
	);
});
