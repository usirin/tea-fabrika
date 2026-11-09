import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {Arbitrary, Effect, Schema} from "effect";
import * as fc from "fast-check";
import {expect, it} from "vitest";
import * as checker from "./field-check.ts";

// Today's field records. Covers field-schema.ts and field-check.ts, including added-row
// selection, optional facts, advisory drift and annotations. No network or real rows.
// T342 source plants, all caught: set-like selection, checking the whole head,
// blocking README enums, accepting bad counts, failing on advice, row text in an
// annotation, and treating failed history reads as empty successful input.
const options = {seed: 119120, numRuns: 100};
const schemaOptions = {seed: 119120, runs: 100};
// Type-law plants are compiled by the final workspace typecheck. Each directive
// itself fails if the installed API or the checked result stops refusing the plant.
// @ts-expect-error Effect 4.1.2 has no Schema.notAnInstalledApi.
type UnsupportedSchemaApi = typeof Schema.notAnInstalledApi;
const typePlants = (
	_unsupported: UnsupportedSchemaApi,
	_report: ReturnType<typeof checker.checkFile>,
) => {};
// @ts-expect-error An unchecked success is missing findings, annotations and added count.
typePlants(undefined, {exitCode: 0});
const Text = Schema.NullOr(Schema.String);
const Count = Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)));
// Independent contract schemas keep the input generator from weakening with a decoder.
const Note = Schema.Struct({
	id: Schema.String,
	date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
	stage: Schema.String,
	kind: Schema.String,
	what: Schema.String,
	lanes: Schema.Array(Schema.Unknown),
	fix: Text,
	cause: Schema.optionalKey(Text),
	person: Schema.optionalKey(Schema.Boolean),
	primitive: Schema.optionalKey(Text),
	test: Schema.optionalKey(Text),
	links: Schema.optionalKey(Schema.Array(Schema.String)),
});
const Run = Schema.Struct({
	date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
	role: Schema.String,
	model: Text,
	effort: Text,
	outcome: Text,
	note: Text,
	why: Text,
	tokens: Count,
	tools: Count,
	minutes: Count,
	run: Schema.optionalKey(Schema.String),
	started: Schema.optionalKey(Text),
	ended: Schema.optionalKey(Text),
	parent: Schema.optionalKey(Text),
	active: Schema.optionalKey(Count),
	costUsd: Schema.optionalKey(Count),
	listUsd: Schema.optionalKey(Count),
	billed: Schema.optionalKey(Count),
	inputTokens: Schema.optionalKey(Count),
	cachedTokens: Schema.optionalKey(Count),
	outputTokens: Schema.optionalKey(Count),
	driver_caused: Schema.optionalKey(Schema.Boolean),
});
const noteFields = [
	"id",
	"date",
	"stage",
	"kind",
	"what",
	"lanes",
	"fix",
	"cause",
	"person",
	"primitive",
	"test",
	"links",
];
const runFields = [
	"date",
	"role",
	"model",
	"effort",
	"outcome",
	"note",
	"why",
	"tokens",
	"tools",
	"minutes",
	"run",
	"started",
	"ended",
	"parent",
	"active",
	"costUsd",
	"listUsd",
	"billed",
	"inputTokens",
	"cachedTokens",
	"outputTokens",
	"driver_caused",
];

it("added rows preserve occurrence counts and head line numbers", () => {
	const line = fc.string({maxLength: 24}).map((s) => JSON.stringify(s));
	fc.assert(
		fc.property(
			fc.array(line, {maxLength: 15}),
			fc.array(line, {minLength: 1, maxLength: 15}),
			(base, extra) => {
				const head = [...base.toReversed(), ...extra, ...(base.length ? [base[0]!] : [])];
				const remaining = [...base];
				const expected = head.flatMap((text, i) => {
					const old = remaining.indexOf(text);
					if (old < 0) return [{line: i + 1, text}];
					remaining.splice(old, 1);
					return [];
				});
				expect(
					checker.selectAdded(base.length ? `${base.join("\n")}\n` : "", `${head.join("\n")}\n`),
				).toEqual(expected);
				expect(checker.selectAdded("", "\n")).toEqual([{line: 1, text: ""}]);
				expect(checker.selectAdded(`${head.join("\n")}\n`, `${head.join("\n")}\n`)).toEqual([]);
			},
		),
		options,
	);
});

it("a push keeps its two event trees and refuses failed diff, tree or blob reads", () => {
	fc.assert(
		fc.property(
			fc.string(),
			fc.string(),
			fc.boolean(),
			fc.boolean(),
			(baseText, headText, existed, remains) => {
				const base = "b".repeat(40),
					head = "c".repeat(40),
					file = "field/notes.jsonl";
				const calls: string[][] = [];
				const run = (args: string[]) => {
					calls.push(args);
					const stdout =
						args[0] === "diff"
							? `${file}\0`
							: args[0] === "ls-tree"
								? (args[4] === base ? existed : remains)
									? `${file}\0`
									: ""
								: args[1]?.startsWith(base)
									? baseText
									: headText;
					return {status: 0, stdout};
				};
				expect(checker.readFieldFiles(base, head, "push", run)).toEqual([
					{file, base: existed ? baseText : "", head: remains ? headText : ""},
				]);
				expect(calls.some((args) => args[0] === "merge-base")).toBe(false);
				const reads = calls.length;
				for (let at = 0; at < reads; at++) {
					let i = 0;
					expect(() =>
						checker.readFieldFiles(base, head, "push", (args) =>
							i++ === at ? {status: 128, stdout: ""} : run(args),
						),
					).toThrow();
				}
			},
		),
		options,
	);
});

// Plan change, 2026-11-09: field-check reads a PR's rows from the merge base, as changes.mjs
// reads its paths. Plant caught: diffing the event's base SHA (main's tip), which counts main's
// newer rows and edits against the PR and shows a field file the PR never touched.
const gitEnv = {...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1"};
const gitIn =
	(dir: string) =>
	(args: string[]): {status: number | null; stdout: string} =>
		spawnSync(
			"git",
			[
				"-C",
				dir,
				"-c",
				"user.name=t",
				"-c",
				"user.email=t@t",
				"-c",
				"core.hooksPath=/dev/null",
				...args,
			],
			{encoding: "utf8", env: gitEnv},
		);
const text = (rows: readonly string[]) => rows.map((row) => `${row}\n`).join("");
it("a PR's field rows compare to the merge base while main moves ahead", () => {
	const row = fc.stringMatching(/^[ -~]{0,20}$/);
	fc.assert(
		fc.property(
			fc.array(row, {maxLength: 6}),
			fc.array(row, {maxLength: 4}),
			fc.array(row, {minLength: 1, maxLength: 4}),
			fc.boolean(),
			fc.boolean(),
			(fork, mine, theirs, dropFirst, notesToo) => {
				const dir = mkdtempSync(join(tmpdir(), "ci-field-"));
				try {
					const git = gitIn(dir);
					const commit = (files: Record<string, string>, message: string) => {
						for (const [file, body] of Object.entries(files)) {
							mkdirSync(dirname(join(dir, file)), {recursive: true});
							writeFileSync(join(dir, file), body);
						}
						expect(git(["add", "-A"]).status).toBe(0);
						expect(git(["commit", "-q", "--allow-empty", "-m", message]).status).toBe(0);
						return git(["rev-parse", "HEAD"]).stdout.trim();
					};
					expect(git(["init", "-q", "-b", "main"]).status).toBe(0);
					const runs = "field/runs.jsonl";
					commit({[runs]: text(fork), "field/notes.jsonl": "", "docs/a.md": ""}, "fork");
					expect(git(["checkout", "-q", "-b", "pr"]).status).toBe(0);
					const head = commit(
						mine.length > 0 ? {[runs]: text([...fork, ...mine])} : {"docs/a.md": "pr\n"},
						"pr",
					);
					expect(git(["checkout", "-q", "main"]).status).toBe(0);
					const ahead = [...(dropFirst ? fork.slice(1) : fork), ...theirs];
					const base = commit(
						{[runs]: text(ahead), ...(notesToo ? {"field/notes.jsonl": text(theirs)} : {})},
						"main moves ahead",
					);
					const files = checker.readFieldFiles(base, head, "pull_request", git);
					expect(files).toEqual(
						mine.length > 0 ? [{file: runs, base: text(fork), head: text([...fork, ...mine])}] : [],
					);
					for (const input of files)
						expect(checker.selectAdded(input.base, input.head).map((added) => added.text)).toEqual(
							mine,
						);
				} finally {
					rmSync(dir, {recursive: true, force: true});
				}
			},
		),
		{...options, numRuns: 25},
	);
});

// Plan change, 2026-11-09: `note` stays optional for rows written before the change. 111 rows
// in field/runs.jsonl, dated 2026-10-23 to 2026-10-27, have no `note`. Plant caught: `note`
// as a required core, which fails each such row when a PR edits or moves it.
it("a run row written before the plan change passes without note", () => {
	const daysBack = Arbitrary.schema(
		Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 4000})),
	);
	const result = Effect.runSync(
		Arbitrary.checkEffect(
			Arbitrary.all([Arbitrary.schema(Run), daysBack]),
			([row, back]) => {
				const date = new Date(Date.UTC(2026, 10, 8) - back * 86_400_000).toISOString().slice(0, 10);
				const old = Object.fromEntries(
					Object.entries({...row, date}).filter(([key]) => key !== "note"),
				);
				const report = checker.checkFile("field/runs.jsonl", "", `${JSON.stringify(old)}\n`);
				return (
					report.exitCode === 0 &&
					report.findings.every((f) => f._tag !== "error") &&
					report.added === 1
				);
			},
			schemaOptions,
		),
	);
	expect(result._tag).toBe("Passed");
});

it("valid cores pass, each blocking field rejects bad types, optional facts stay unknown", () => {
	for (const [schema, file, fields] of [
		[Note, "field/notes.jsonl", noteFields],
		[Run, "field/runs.jsonl", runFields],
	] as const) {
		const result = Effect.runSync(
			Arbitrary.checkEffect(
				Arbitrary.schema(schema),
				(row) => {
					const text = JSON.stringify({...row, extra: {future: true}, ticket: 342, pr: null});
					const good = checker.checkFile(file, "", `${text}\n`);
					const broken = fields.every((field) => {
						const bad = checker.checkFile(
							file,
							"",
							`${JSON.stringify({...row, [field]: {bad: true}})}\n`,
						);
						return (
							bad.exitCode !== 0 &&
							bad.findings.some((f) => f._tag === "error" && f.field === field)
						);
					});
					const required =
						file === "field/notes.jsonl"
							? ["id", "date", "stage", "kind", "what", "lanes", "fix"]
							: [
									"date",
									"role",
									"model",
									"effort",
									"outcome",
									// `note` is optional for rows written before the plan change.
									"why",
									"tokens",
									"tools",
									"minutes",
								];
					const missing = required.every(
						(field) =>
							checker.checkFile(
								file,
								"",
								JSON.stringify(
									Object.fromEntries(Object.entries(row).filter(([key]) => key !== field)),
								),
							).exitCode !== 0,
					);
					return good.exitCode === 0 && good.added === 1 && broken && missing;
				},
				schemaOptions,
			),
		);
		expect(result._tag).toBe("Passed");
	}
});

it("negative and nonfinite counts, missing cores and wrong dates fail without coercion", () => {
	const result = Effect.runSync(
		Arbitrary.checkEffect(
			Arbitrary.schema(Run),
			(row) => {
				const errors = [
					...[
						"tokens",
						"tools",
						"minutes",
						"active",
						"costUsd",
						"listUsd",
						"billed",
						"inputTokens",
						"cachedTokens",
						"outputTokens",
					].flatMap((field) => [-1, "0", true].map((bad) => ({...row, [field]: bad}))),
					...Object.keys(Run.fields)
						.slice(0, 10)
						// `note` is optional for rows written before the plan change.
						.filter((field) => field !== "note")
						.map((field) =>
							Object.fromEntries(Object.entries(row).filter(([key]) => key !== field)),
						),
					{...row, date: "yesterday"},
				];
				return (
					errors.every(
						(bad) =>
							checker.checkFile("field/runs.jsonl", "", `${JSON.stringify(bad)}\n`).exitCode !== 0,
					) &&
					checker.checkFile(
						"field/runs.jsonl",
						"",
						JSON.stringify(row).replace(/"tokens":[^,}]*/, '"tokens":1e999'),
					).exitCode !== 0
				);
			},
			schemaOptions,
		),
	);
	expect(result._tag).toBe("Passed");
});

it("advice warns with exit zero; errors identify head lines without row content", () => {
	fc.assert(
		fc.property(
			fc.integer({min: 1, max: 12}),
			fc.string({minLength: 1, maxLength: 30}),
			(old, payload) => {
				const base = `${Array.from({length: old}, () => "old malformed row").join("\n")}\n`;
				const marker = `private-${JSON.stringify(payload)}-end\r\n%`;
				const row = {
					id: "bad id",
					date: "2026-99-99",
					stage: "new-stage",
					kind: "new-kind",
					what: marker,
					lanes: [42],
					fix: null,
				};
				const report = checker.checkFile(
					"field/notes.jsonl",
					base,
					`${base}${JSON.stringify(row)}\n`,
				);
				expect(report.exitCode).toBe(0);
				expect(report.added).toBe(1);
				expect(report.findings.some((f) => f._tag === "warning")).toBe(true);
				expect(
					report.findings.every((f) => f.line === old + 1 && f.file === "field/notes.jsonl"),
				).toBe(true);
				const bad = checker.checkFile(
					"field/notes.jsonl",
					base,
					`${base}${JSON.stringify({...row, what: 42})}\n${marker}\n`,
				);
				expect(bad.exitCode).not.toBe(0);
				expect(
					bad.findings.some((f) => f._tag === "error" && f.line === old + 1 && f.field === "what"),
				).toBe(true);
				for (const annotation of [...report.annotations, ...bad.annotations]) {
					expect(annotation).not.toContain(marker);
					expect(annotation).not.toContain(payload.length > 5 ? payload : marker);
					expect(annotation).not.toMatch(/[\r\n]/);
				}
				const unknown = checker.checkFile(
					"field/future.jsonl",
					"",
					`${JSON.stringify({text: marker})}\n`,
				);
				expect(unknown.exitCode).toBe(0);
				expect(unknown.findings.some((f) => f._tag === "warning")).toBe(true);
				for (const text of ["null", "[]", '"text"', "1", "{", "\n"])
					expect(checker.checkFile("field/future.jsonl", "", text).exitCode).not.toBe(0);
			},
		),
		options,
	);
});

// scenario: lead's real-PR proof, deliberately not a network-dependent local test.
// Open a field-only PR on this branch. Record both PR URLs/SHAs and the Actions URL.
// Show changes + skills + tracked-file scans pass; check/next/e2e/all six shards skip
// without runners; field starts independently and validates only new rows. Plant an
// invalid row and see field fail, then fix it; advisory drift must warn with exit 0.
// Close the proof PR. Its non-main base means commits does not run: no 44 s claim.
// The implementation PR must pass commits and every heavy job, show no next files in
// today's shards, retain every next test, and record setup/install/test/wall timings.
