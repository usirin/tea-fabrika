import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {moveFaults, partFaults, renameFaults, splitFaults} from "./movecheck.ts";

// Lead tooling for ticket 477: the laws of the move checker. libfabrika's files move into rooms
// over 16 pull requests (decision 0043), and a move must change no line of logic. `movecheck` reads
// a pull request's diff and says where it did more than move. These laws run on its pure functions
// over diff data, so none needs a git repository.
//
// The four entry points, each answering a list of faults, empty when the diff is clean. A fault
// names the file it is about in `path`: a rename's `to`, a move's `to`, any other change's `path`.
// These laws read only that, never a fault's words.
//   moveFaults(changes, {moves, named})      a move PR (the plan's PRs 2 to 5)
//   splitFaults(before, after)               a split PR (`--split`, PRs 7 and 8)
//   renameFaults(changes, table)             a rename PR (`--renamed <table>`, PRs 14 and 15)
//   partFaults(moves, {base, head}, except)  each moved file keeps its row of the rule file
const options = {seed: 119120, numRuns: 300};

type Change = Parameters<typeof moveFaults>[0][number];
type Move = Parameters<typeof moveFaults>[1]["moves"][number];
type Row = Parameters<typeof partFaults>[1]["base"][number];

const SRC = "next/packages/libfabrika/src";

const paths = (faults: ReadonlyArray<{readonly path: string}>): ReadonlyArray<string> =>
	[...new Set(faults.map((fault) => fault.path))].sort();

const pascal = (name: string): string => `${name.slice(0, 1).toUpperCase()}${name.slice(1)}`;
const word = fc.stringMatching(/^[a-z]{2,7}$/);

// A generated file: import and re-export statements, then body lines. A statement keeps its words
// and its specifier apart, so a move can rewrite the one and a planted edit can change the other.
interface Statement {
	readonly words: string;
	readonly specifier: string;
}

interface Text {
	readonly statements: ReadonlyArray<Statement>;
	readonly body: ReadonlyArray<string>;
}

const specifier = fc
	.tuple(fc.constantFrom("./", "../data/", "../coordination/", "../../app/"), word)
	.map(([folder, name]) => `${folder}${name}.ts`);

const statement: fc.Arbitrary<Statement> = fc.record({
	words: fc.constantFrom(
		"import {a} from",
		"import type {B} from",
		"import * as c from",
		"import",
		"export {d} from",
		"export type {E} from",
		"export * from",
		"import {\n\tf,\n\tg,\n} from",
		"export {\n\th,\n\ti,\n} from",
	),
	specifier,
});

const bodyLine = fc
	.tuple(
		fc.constantFrom(
			"const total = N;",
			"\tif (count > N) {",
			"\t\tqueue.push(N);",
			"\t}",
			"export const limit = N + 1;",
			"\treturn yield* step(N);",
		),
		fc.nat({max: 9}),
	)
	.map(([line, n]) => line.replace("N", String(n)));

const text: fc.Arbitrary<Text> = fc.record({
	statements: fc.array(statement, {maxLength: 6}),
	body: fc.array(bodyLine, {minLength: 1, maxLength: 8}),
});

const written = (t: Text): string =>
	[...t.statements.map((s) => `${s.words} "${s.specifier}";`), "", ...t.body, ""].join("\n");

/** The same file after a move: some specifiers point somewhere new, and nothing else differs. */
const respecified = (t: Text): fc.Arbitrary<Text> =>
	fc
		.array(fc.option(specifier, {nil: undefined}), {
			minLength: t.statements.length,
			maxLength: t.statements.length,
		})
		.map((next) => ({
			statements: t.statements.map((s, n) => ({words: s.words, specifier: next[n] ?? s.specifier})),
			body: t.body,
		}));

/** The same statement with one more name in it: the names changed, and the specifier did not. */
const renamedWords = (words: string): string => {
	if (words.includes("{")) {
		return words.replace("{", "{z, ");
	}

	if (words === "import * as c from") {
		return "import * as z from";
	}

	return words === "export * from" ? "export * as z from" : "import z from";
};

/** One edit that is not a specifier: a changed, dropped or added body line, or other imported names. */
const edited = (t: Text): fc.Arbitrary<Text> =>
	fc
		.tuple(
			fc.constantFrom("changed", "dropped", "added", "names"),
			fc.nat({max: t.body.length - 1}),
			fc.nat({max: Math.max(0, t.statements.length - 1)}),
		)
		.map(([what, line, at]) => {
			const body = [...t.body];

			if (what === "names" && t.statements[at] !== undefined) {
				return {
					statements: t.statements.map((s, n) =>
						n === at ? {words: renamedWords(s.words), specifier: s.specifier} : s,
					),
					body,
				};
			}

			if (what === "dropped" && body.length > 1) {
				body.splice(line, 1);
			} else if (what === "added") {
				body.splice(line, 0, "audit(1);");
			} else {
				// The plan's plant: one character of a moved function body.
				body[line] = `${body[line]}!`;
			}

			return {statements: t.statements, body};
		});

const before = text.chain((old) => fc.tuple(fc.constant(old), respecified(old)));
const NAMED = ["layer-rules.json", ".oxlintrc.json", ".patterns/libfabrika-rooms.md"];

describe("movecheck, a move PR: only the table's renames, and only specifiers change", () => {
	// Plant (the plan's): change one character in a moved function body. Also: read a statement's
	// names as part of its specifier, or compare nothing but the count of lines.
	it("a renamed file's text may differ only in import and export-from specifiers", () => {
		const move: Move = {from: `${SRC}/data/log.ts`, to: `${SRC}/ledger/Log.ts`};
		fc.assert(
			fc.property(
				before.chain(([old, moved]) =>
					fc.tuple(fc.constant(old), fc.constant(moved), edited(moved)),
				),
				([old, moved, broken]) => {
					const renamed = (after: Text): Change => ({
						_tag: "renamed",
						...move,
						before: written(old),
						after: written(after),
					});
					expect(moveFaults([renamed(moved)], {moves: [move], named: []})).toEqual([]);
					expect(paths(moveFaults([renamed(broken)], {moves: [move], named: []}))).toEqual([
						move.to,
					]);
				},
			),
			options,
		);
	});

	// What one row of the plan's table did in the generated pull request: moved as the table says,
	// moved somewhere else, or deleted with no new path.
	const fate = fc.constantFrom("moved", "elsewhere", "gone");
	const stray = fc.constantFrom("added", "deleted", "edited", "renamed");

	// Plants (the plan's): add a new file; delete one with no new path. Also: take any rename, in
	// the table or not; take an edit to a file the plan did not name.
	it("a move PR changes only the table's renames, files that only follow them, and the named files", () => {
		fc.assert(
			fc.property(
				fc.uniqueArray(word, {minLength: 1, maxLength: 6}),
				fc.array(fate, {minLength: 6, maxLength: 6}),
				fc.array(stray, {maxLength: 4}),
				before,
				text.chain((t) => fc.tuple(fc.constant(t), edited(t))),
				(names, fates, strays, [old, moved], [config, changed]) => {
					const moves: ReadonlyArray<Move> = names.map((name) => ({
						from: `${SRC}/data/${name}.ts`,
						to: `${SRC}/ledger/${pascal(name)}.ts`,
					}));
					const fromTable = moves.flatMap((move, n): ReadonlyArray<Change> => {
						const texts = {before: written(old), after: written(moved)};

						switch (fates[n]) {
							case "moved":
								return [{_tag: "renamed", ...move, ...texts}];
							case "elsewhere":
								return [
									{_tag: "renamed", from: move.from, to: `${move.to}.elsewhere.ts`, ...texts},
								];
							default:
								return [{_tag: "deleted", path: move.from, before: texts.before}];
						}
					});
					const wrong = moves.flatMap((move, n) =>
						fates[n] === "moved"
							? []
							: [fates[n] === "elsewhere" ? `${move.to}.elsewhere.ts` : move.from],
					);
					const outside = strays.map((what, n): Change => {
						const path = `${SRC}/node/stray${n}.ts`;

						switch (what) {
							case "added":
								return {_tag: "added", path, after: written(old)};
							case "deleted":
								return {_tag: "deleted", path, before: written(old)};
							case "renamed":
								return {
									_tag: "renamed",
									from: `${SRC}/app/stray${n}.ts`,
									to: path,
									before: written(old),
									after: written(old),
								};
							default:
								return {_tag: "modified", path, before: written(config), after: written(changed)};
						}
					});
					// Clean, whatever else the PR holds: a file that imports a moved one and only follows
					// it, and the configs and docs the plan names, which may change in any way.
					const clean: ReadonlyArray<Change> = [
						{
							_tag: "modified",
							path: `${SRC}/workers/runtime.ts`,
							before: written(old),
							after: written(moved),
						},
						...NAMED.map((path): Change => ({
							_tag: "modified",
							path,
							before: written(config),
							after: written(changed),
						})),
					];
					const faults = moveFaults([...clean, ...fromTable, ...outside], {moves, named: NAMED});
					expect(paths(faults)).toEqual(
						[...wrong, ...strays.map((_, n) => `${SRC}/node/stray${n}.ts`)].sort(),
					);
				},
			),
			options,
		);
	});
});

describe("movecheck --split: every old line lands once, in order, and new lines only wire the parts", () => {
	interface Cut {
		readonly lines: ReadonlyArray<string>;
		/** Where each line goes: 0 stays in the front file, n goes to part n. */
		readonly to: ReadonlyArray<number>;
		readonly effect: boolean;
	}

	const FRONT = `${SRC}/runtime/Runner.ts`;
	const part = (n: number) => `${SRC}/runtime/internal/part${n}.ts`;
	const old = (cut: Cut) => ({
		path: FRONT,
		text: [
			'import {Effect} from "effect";',
			"export const run = (deps: Deps) => {",
			...cut.lines.map((line) => `\t${line}`),
			"};",
			"",
		].join("\n"),
	});
	/** The new files, from what each one holds of the old body: `held[0]` is the front file's. */
	const split = (cut: Cut, held: ReadonlyArray<ReadonlyArray<string>>) => {
		const call = (n: number) => (cut.effect ? `\tyield* part${n}(deps);` : `\tpart${n}(deps);`);
		const parts = held.slice(1).map((_, n) => n + 1);
		return [
			{
				path: FRONT,
				text: [
					'import {Effect} from "effect";',
					...parts.map((n) => `import {part${n}} from "./internal/part${n}.ts";`),
					"export const run = (deps: Deps) => {",
					...(held[0] ?? []).map((line) => `\t${line}`),
					...parts.map(call),
					"};",
					"",
				].join("\n"),
			},
			...parts.map((n) => ({
				path: part(n),
				text: [
					'import type {Deps} from "../Runner.ts";',
					"/** @internal */",
					`export const part${n} = (deps: Deps) => {`,
					// A cut-out line may sit deeper or shallower than it did.
					...(held[n] ?? []).map((line) => `\t\t${line}`),
					"};",
					"",
				].join("\n"),
			})),
		];
	};
	const held = (cut: Cut): Array<Array<string>> =>
		Array.from({length: Math.max(1, ...cut.to) + 1}, (_, n) =>
			cut.lines.filter((_line, at) => cut.to[at] === n),
		);
	const cutOver = (lines: fc.Arbitrary<ReadonlyArray<string>>): fc.Arbitrary<Cut> =>
		lines.chain((ls) =>
			fc.record({
				lines: fc.constant(ls),
				to: fc.array(fc.nat({max: 3}), {minLength: ls.length, maxLength: ls.length}),
				effect: fc.boolean(),
			}),
		);
	// Few shapes and few numbers, so one line often stands in the old file more than once.
	const repeated = fc.array(
		fc
			.tuple(
				fc.constantFrom(
					"total += N;",
					"queue.push(N);",
					"if (count > N) {",
					"}",
					"yield* step(N);",
				),
				fc.nat({max: 2}),
			)
			.map(([line, n]) => line.replace("N", String(n))),
		{minLength: 2, maxLength: 12},
	);
	const distinct = fc
		.array(fc.constantFrom("total += N;", "queue.push(N);", "const vN = read();"), {
			minLength: 2,
			maxLength: 12,
		})
		.map((lines) => lines.map((line, n) => line.replace("N", String(n))));

	// Plants (the plan's): change a condition while moving it; drop one line. Also: count each
	// distinct line once, so a second copy of a line may go missing or appear; take any new line.
	// The new lines a clean cut may add are the ones written in `split`: an import, the `@internal`
	// comment, a cut-out function's header and its closing `};`, and a call to it.
	it("a clean cut has no fault; a changed, dropped, doubled or new line of logic has one", () => {
		fc.assert(
			fc.property(
				cutOver(repeated),
				fc.constantFrom("changed", "dropped", "doubled", "new"),
				fc.nat(),
				fc.nat(),
				(cut, what, pick, other) => {
					const clean = held(cut);
					expect(splitFaults(old(cut), split(cut, clean))).toEqual([]);

					const broken = clean.map((lines) => [...lines]);
					const at = pick % cut.lines.length;
					const file = broken[cut.to[at] ?? 0] ?? [];
					const line = cut.lines[at] ?? "";
					const where = file.indexOf(line);

					if (what === "changed") {
						file[where] = line.replace(/\d/, (digit) => `${digit}7`).replace(/^\}$/, "} else {");
					} else if (what === "dropped") {
						file.splice(where, 1);
					} else if (what === "doubled" && line !== "}") {
						(broken[other % broken.length] ?? file).push(line);
					} else {
						file.push("audit(deps);");
					}

					expect(splitFaults(old(cut), split(cut, broken))).not.toEqual([]);
				},
			),
			options,
		);
	});

	// Plant: check only that every old line is somewhere, and not where.
	it("two lines of one new file in the other order are a fault", () => {
		fc.assert(
			fc.property(cutOver(distinct), fc.nat(), (cut, pick) => {
				const clean = held(cut);
				const files = clean.flatMap((lines, n) => (lines.length > 1 ? [n] : []));
				fc.pre(files.length > 0);

				const broken = clean.map((lines) => [...lines]);
				const file = broken[files[pick % files.length] ?? 0] ?? [];
				const at = pick % (file.length - 1);
				[file[at], file[at + 1]] = [file[at + 1] ?? "", file[at] ?? ""];

				expect(splitFaults(old(cut), split(cut, clean))).toEqual([]);
				expect(splitFaults(old(cut), split(cut, broken))).not.toEqual([]);
			}),
			options,
		);
	});
});

describe("movecheck --renamed: only the listed names change", () => {
	// 0038's rename and the access rename (the plan's PRs 14 and 15). `piece`, `row`, `count` and
	// `healthRow` are in no table: 0038 says `piece` stays, and `healthRow` only starts like a listed name.
	const LISTED = [
		{from: "health", to: "measurements"},
		{from: "Health", to: "Measurements"},
		{from: "summarized", to: "aggregated"},
		{from: "foldMembers", to: "foldAccess"},
		{from: "members", to: "access"},
	];
	const KEPT = ["piece", "row", "count", "healthRow"];
	const name = fc.constantFrom(...LISTED.map((r) => r.from), ...KEPT);
	const kept = fc.constantFrom(...KEPT);
	// Each line ends in a name no table lists, so a planted edit always has one to change.
	const line = fc.oneof(
		fc.tuple(name, name, kept).map(([a, b, c]) => `const ${a} = ${b}.${c};`),
		fc.tuple(name, kept).map(([a, c]) => `\t"${a}": ${c},`),
		fc
			.tuple(name, kept)
			.map(([a, c]) => `const sql = "select ${c} from ${a} where door/${a} = ${c}";`),
		fc.tuple(name, kept).map(([a, c]) => `export const ${a}Row = (${c}: number) => ${c};`),
	);
	const renameIn = (text: string, table: ReadonlyArray<{from: string; to: string}>): string =>
		text.replace(/[A-Za-z_$][\w$]*/g, (token) => table.find((r) => r.from === token)?.to ?? token);
	const PATH = `${SRC}/telemetry/internal/measurements.ts`;

	// Plant (the plan's): rename a field 0038 says stays, such as `piece`. Also: take any changed
	// word on a line that also holds a listed rename; rename a listed name to a word not in its row.
	it("a listed name may change, on any of its lines; any other edit is a fault", () => {
		fc.assert(
			fc.property(
				fc.subarray(LISTED, {minLength: 1}),
				fc.array(fc.tuple(line, fc.boolean()), {minLength: 1, maxLength: 10}),
				fc.nat(),
				fc.constantFrom("kept", "wrong", "logic"),
				(table, lines, pick, what) => {
					const before = lines.map(([l]) => l);
					const after = lines.map(([l, renamed]) => (renamed ? renameIn(l, table) : l));
					const change = (text: ReadonlyArray<string>) => [
						{path: PATH, before: `${before.join("\n")}\n`, after: `${text.join("\n")}\n`},
					];
					expect(renameFaults(change(after), table)).toEqual([]);

					const at = pick % after.length;
					const broken = [...after];
					const target = after[at] ?? "";
					const listed = table.find((r) => new RegExp(`\\b${r.to}\\b`).test(target));

					if (what === "wrong" && listed !== undefined) {
						broken[at] = target.replace(new RegExp(`\\b${listed.to}\\b`), `${listed.to}Else`);
					} else if (what === "logic") {
						broken[at] = `${target} audit();`;
					} else {
						// The last name on the line is one no table lists.
						const last = KEPT.toSorted((a, b) => b.length - a.length).find((k) =>
							new RegExp(`\\b${k}\\b`).test(target),
						);
						broken[at] = target.replace(new RegExp(`\\b${last}\\b`), `${last}Renamed`);
					}

					expect(paths(renameFaults(change(broken), table))).toEqual([PATH]);
				},
			),
			{
				...options,
				// pinned: the plan's plant (ticket 477, PR 14). `piece` is a field 0038 keeps.
				examples: [
					[[LISTED[0] ?? {from: "", to: ""}], [["const health = row.piece;", true]], 0, "kept"],
				],
			},
		);
	});
});

describe("movecheck: each moved file keeps its row of the rule file", () => {
	// Rows of the plan's files tables (PRs 2 to 5): old path, new path, and the row of the rule file
	// that names the file before and after. The exam maps a row to a part and that map does not
	// change in a move, so the same row is the same exam part.
	const TABLE: ReadonlyArray<readonly [from: string, to: string, row: string]> = [
		["id.ts", "Id.ts", "next-id"],
		["data/sink.ts", "telemetry/Sink.ts", "next-data"],
		["data/health.ts", "telemetry/internal/health.ts", "next-data"],
		["data/log.ts", "ledger/Log.ts", "next-data"],
		["data/ledger-store.ts", "ledger/internal/ledgerStore.ts", "next-data"],
		["transport/wire.ts", "transport/Wire.ts", "next-transport"],
		["coordination/mailbox.ts", "processes/Mailbox.ts", "next-coordination"],
		["coordination/gateway-manager.ts", "presence/GatewayManager.ts", "next-coordination"],
		["coordination/members.ts", "access/Members.ts", "next-coordination"],
		["coordination/process-store.ts", "runtime/ProcessStore.ts", "next-coordination"],
		["coordination/process-store.test.ts", "runtime/ProcessStore.test.ts", "next-coordination"],
		["coordination/recovery.ts", "runtime/internal/recovery.ts", "next-coordination"],
		["app/runner.ts", "runtime/Runner.ts", "next-app"],
		["app/supervisor.ts", "runtime/internal/supervisor.ts", "next-app"],
		["testing.ts", "Testing.ts", "next-app"],
		["door/door.ts", "door/Door.ts", "next-door"],
	];
	const ROWS = [
		"next-door",
		"next-app",
		"next-coordination",
		"next-data",
		"next-transport",
		"next-id",
	];
	const at = (path: string) => `${SRC}/${path}`;
	const moves: ReadonlyArray<Move> = TABLE.map(([from, to]) => ({from: at(from), to: at(to)}));

	// Plants: compare nothing when a file has no row on the head; excuse every file once one is
	// excused; read the row from the old path on both sides.
	it("a file moved to another row, or left with no row, is a fault, and only a named exception is excused", () => {
		// The rule file with one exact path per file, so each file's row can be changed alone.
		const rows = (side: 0 | 1, moved: ReadonlyMap<string, string | null>): ReadonlyArray<Row> =>
			ROWS.map((name) => ({
				name,
				paths: TABLE.filter(
					(entry) => (moved.has(entry[1]) ? moved.get(entry[1]) : entry[2]) === name,
				).map((entry) => at(entry[side])),
			}));
		fc.assert(
			fc.property(
				fc.subarray([...TABLE]).chain((broken) =>
					fc.tuple(
						fc.constant(broken),
						fc.array(fc.option(fc.constantFrom(...ROWS), {nil: null}), {
							minLength: broken.length,
							maxLength: broken.length,
						}),
						fc.subarray([...TABLE]),
					),
				),
				([broken, rowsNow, excused]) => {
					// Each broken file's row on the head: another row, or none.
					const moved = new Map(
						broken.flatMap((entry, n): ReadonlyArray<readonly [string, string | null]> =>
							rowsNow[n] === entry[2] ? [] : [[entry[1], rowsNow[n] ?? null]],
						),
					);
					const rules = {base: rows(0, new Map()), head: rows(1, moved)};
					const except = excused.map((entry) => at(entry[0]));
					expect(partFaults(moves, {base: rules.base, head: rows(1, new Map())}, [])).toEqual([]);
					expect(paths(partFaults(moves, rules, except))).toEqual(
						[...moved.keys()]
							.filter((to) => !excused.some((entry) => entry[1] === to))
							.map(at)
							.sort(),
					);
				},
			),
			options,
		);
	});

	// main's rows for libfabrika at 33a282f8, and the head as PRs 1 to 5 leave it (the plan's config
	// table): each old row gains its rooms, and three patterns keep three runtime files in coordination.
	const BASE: ReadonlyArray<Row> = [
		{name: "next-door", paths: [at("door")]},
		{name: "next-app", paths: [at("app"), at("testing.ts")]},
		{name: "next-coordination", paths: [at("coordination")]},
		{name: "next-data", paths: [at("data")]},
		{name: "next-transport", paths: [at("transport")]},
		{name: "next-id", paths: [at("id.ts")]},
	];
	const head = (kept: ReadonlyArray<string>): ReadonlyArray<Row> => [
		{name: "next-door", paths: [at("door")]},
		{name: "next-app", paths: [at("app"), at("runtime"), at("Testing.ts")]},
		{
			name: "next-coordination",
			paths: [at("coordination"), at("processes"), at("presence"), at("access"), ...kept.map(at)],
		},
		{name: "next-data", paths: [at("data"), at("telemetry"), at("ledger")]},
		{name: "next-transport", paths: [at("transport")]},
		{name: "next-id", paths: [at("Id.ts")]},
	];
	const KEPT = ["runtime/ProcessStore*", "runtime/RecoveryStore*", "runtime/internal/recovery.ts"];

	// scenario: the plan's plant, on rows with folder and `*` patterns as the real rule file has,
	// since the three runtime files stay coordination only by a pattern that is easy to leave out
	// (ticket 477, PR 5), and then the file reads as app, which may not import the ledger.
	it("scenario: without the ProcessStore pattern the file reads as app, and that is a fault", () => {
		expect(partFaults(moves, {base: BASE, head: head(KEPT)}, [])).toEqual([]);
		expect(paths(partFaults(moves, {base: BASE, head: head(KEPT.slice(1))}, []))).toEqual(
			[at("runtime/ProcessStore.test.ts"), at("runtime/ProcessStore.ts")].sort(),
		);
	});

	// scenario: the one named exception, since 0043 moves the door's waiting room out of transport
	// on purpose (PR 5), and no other file may change its part.
	it("scenario: waiting.ts goes from transport to door, and only when it is named", () => {
		const waiting = [
			{from: at("transport/waiting.ts"), to: at("door/internal/waiting.ts")},
			{from: at("transport/waiting.test.ts"), to: at("door/internal/waiting.test.ts")},
		];
		const rules = {base: BASE, head: head(KEPT)};
		expect(paths(partFaults([...moves, ...waiting], rules, []))).toEqual(
			waiting.map((m) => m.to).sort(),
		);
		expect(
			partFaults(
				[...moves, ...waiting],
				rules,
				waiting.map((m) => m.from),
			),
		).toEqual([]);
	});
});
