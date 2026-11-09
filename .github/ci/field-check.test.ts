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

it("field history keeps exact event trees and refuses failed diff, tree or blob reads", () => {
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
				expect(checker.readFieldFiles(base, head, run)).toEqual([
					{file, base: existed ? baseText : "", head: remains ? headText : ""},
				]);
				expect(calls.some((args) => args[0] === "merge-base")).toBe(false);
				const reads = calls.length;
				for (let at = 0; at < reads; at++) {
					let i = 0;
					expect(() =>
						checker.readFieldFiles(base, head, (args) =>
							i++ === at ? {status: 128, stdout: ""} : run(args),
						),
					).toThrow();
				}
			},
		),
		options,
	);
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
									"note",
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
