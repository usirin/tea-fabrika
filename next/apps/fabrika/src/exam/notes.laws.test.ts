import {applyCell, type Cmd, type Machine as TeaMachine, type Sub} from "@demlik/tea";
import {Machine} from "@demlik/tea/effect";
import {stubCtxThrowingProxy} from "@demlik/tea/pbt";
// P8, next/. Port source: programs/markdown/src/index.laws.test.ts at 2c29c13f433c.
// Mapping: showsWhatItIsTold -> latest accepted save, no parsing Cmds;
// startsEmpty -> real init; propertyTrace -> accepted replay; keepsTheFirst/startsWithAHeading -> plants.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import {expect, it} from "@effect/vitest";
import {syncTest} from "@kampus/libfabrika/testing";
import {Arbitrary, Effect, FileSystem, Schema} from "effect";

const SEED = 119120;
const options = {arbitrary: {seed: SEED, runs: 300, size: 4096, concurrency: 1}, timeout: 60_000};
const Text = Schema.Union([
	Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(4096)),
	Schema.Literals([
		"# Hi",
		"- a\n- b",
		"| a |\n|---|\n| 1 |",
		"```ts\ncode\n```",
		"> q",
		"---",
		"مرحبا 🧪",
		"",
	]),
]);
const Texts = Arbitrary.array(Arbitrary.schema(Text), {minLength: 0, maxLength: 32});
const int = (min: number, max: number) =>
	Schema.Int.check(Schema.isBetween({minimum: min, maximum: max}));
const Note = Schema.Literals([
	"note_0000000000e008000000000001",
	"note_0000000000e008000000000002",
]);
const Bases = Arbitrary.schema(
	Schema.TaggedUnion({
		version: {n: int(0, 64)},
		negative: {n: int(0, 64)},
		fractional: {numerator: int(-64, 64), denominator: int(2, 8)},
		future: {n: int(0, 64)},
	}),
).pipe(
	Arbitrary.map((b) =>
		b._tag === "negative"
			? -Math.max(1, b.n)
			: b._tag === "fractional"
				? b.numerator / b.denominator
				: b._tag === "future"
					? b.n + 65
					: b.n,
	),
);
// These are already accepted letters, including old bases a fresh guard might now refuse.
// Replay never asks that guard. Fresh stale saves are checked in notes-contract.test.ts.
const SaveSequences = Arbitrary.array(
	Arbitrary.all({
		note: Arbitrary.schema(int(0, 7)),
		writer: Arbitrary.schema(int(0, 7)),
		body: Arbitrary.schema(Text),
		base: Bases,
		clock: Arbitrary.schema(int(0, 281474976710655)),
		arrivedAt: Arbitrary.schema(int(0, 281474976710655)),
		rev: Arbitrary.schema(int(0, 4096)),
		how: Arbitrary.schema(Schema.Literals(["pause", "leave", "done", "kept", "agent"])),
		from: Arbitrary.schema(Schema.UndefinedOr(Schema.Struct({note: Note, version: int(0, 64)}))),
	}),
	{minLength: 0, maxLength: 32},
);
type Sequence = typeof SaveSequences extends Arbitrary.Arbitrary<infer S> ? S : never;
const exact = (actual: unknown, expected: unknown) => expect(actual).toEqual(expected);
const history = (saves: Sequence) =>
	saves.map((s, i) => ({
		note: `note_0000000000e00800000000000${s.note + 1}`,
		version: saves.slice(0, i + 1).filter((prior) => prior.note === s.note).length,
		body: s.body,
		...(s.how === "agent" ? {} : {how: s.how}),
		...(s.from === undefined ? {} : {from: s.from}),
		by: `SHA256:exam-writer-${s.writer}`,
		arrivedAt: s.arrivedAt,
		sentAt: new Date(s.clock).toISOString(),
		// Expose placing too: a global rev never becomes a note's version.
		rev: s.rev,
	}));

type Bound = {
	readonly latest: (texts: ReadonlyArray<string>) => {
		readonly bodies: ReadonlyArray<string>;
		readonly cmds: ReadonlyArray<unknown>;
		readonly initial: string;
	};
	readonly histories: (saves: Sequence) => {
		readonly live: unknown;
		readonly replay: unknown;
		readonly cuts: ReadonlyArray<unknown>;
	};
	readonly machine: TeaMachine<unknown, {readonly type: string}, Cmd, Sub, undefined>;
	readonly messages: (saves: Sequence) => ReadonlyArray<{readonly type: string}>;
	readonly encode: (model: unknown) => unknown;
	readonly decode: (raw: unknown) => unknown;
};
const bind = (): Bound => {
	throw new Error("P13 started: install real notes machine imports; partial code is a failure");
};
const notesPaths = [
	"../../../../programs/notes",
	"../../../../programs/notes/package.json",
	"../../../../programs/notes/src/program.ts",
	"../../../../programs/notes/program.ts",
];
const drawingPaths = [
	"root.ts",
	"window.tsx",
	"draw.tsx",
	"drawn.tsx",
	"markdown.ts",
	"highlight.ts",
	"highlight.tsx",
	"highlighter.ts",
].flatMap((file) => [
	`../../../../programs/notes/src/${file}`,
	`../../../../programs/notes/${file}`,
]);
const checkBound = (
	b: Partial<Record<"latest" | "histories" | "messages" | "encode" | "decode", unknown>> & {
		readonly machine?: {readonly init?: unknown};
	},
) => {
	for (const name of ["latest", "histories", "messages", "encode", "decode"] as const)
		if (typeof b[name] !== "function") throw new Error(`missing notes export: ${name}`);
	if (typeof b.machine?.init !== "function") throw new Error("missing notes machine");
};
const checkDrawing = (draw: (body: string) => unknown) => {
	if (typeof draw !== "function") throw new Error("missing drawing export");
};
const presence = <A>(
	paths: ReadonlyArray<string>,
	files: ReadonlySet<string>,
	load: () => A,
	check: (a: A) => void,
): A | null => {
	if (!paths.some((p) => files.has(p))) return null;
	const value = load();
	check(value);
	return value;
};
const found = Effect.fnUntraced(function* (paths: ReadonlyArray<string>) {
	const fs = yield* FileSystem.FileSystem;
	const files = new Set<string>();
	for (const p of paths) if (yield* fs.exists(new URL(p, import.meta.url).pathname)) files.add(p);
	return files;
});
const present = Effect.gen(function* () {
	return presence(notesPaths, yield* found(notesPaths), bind, checkBound);
}).pipe(Effect.provide(NodeFileSystem.layer));
const drawBinding = (): ((body: string) => unknown) => {
	throw new Error("P22 started: bind real drawing");
};
const drawingPresent = Effect.gen(function* () {
	return presence(drawingPaths, yield* found(drawingPaths), drawBinding, checkDrawing);
}).pipe(Effect.provide(NodeFileSystem.layer));

it.effect.prop(
	"not built: P13 / latest accepted text replaces all earlier text, empty from init, no parsing work",
	{texts: Texts},
	({texts}, ctx) =>
		Effect.gen(function* () {
			const d = yield* present;
			if (d === null) return ctx.skip("not built: P13 notes");
			const actual = d.latest(texts);
			exact(actual.initial, "");
			exact(actual.bodies, texts);
			exact(actual.cmds, []);
		}),
	options,
);
it.effect.prop(
	"not built: P13 / live fold, accepted replay and every save/load cut agree",
	{saves: SaveSequences},
	({saves}, ctx) =>
		Effect.gen(function* () {
			const d = yield* present;
			if (d === null) return ctx.skip("not built: P13 notes");
			const actual = d.histories(saves),
				expected = history(saves);
			exact(actual.live, expected);
			exact(actual.replay, expected);
			expect(actual.cuts).toHaveLength(saves.length + 1);
			for (const cut of actual.cuts) exact(cut, expected);
			syncTest(d.machine, stubCtxThrowingProxy<undefined>(), {
				msgs: d.messages(saves),
				encode: d.encode,
				decode: d.decode,
				equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
				seed: SEED,
			});
		}),
	options,
);
it.effect.prop(
	"not built: P22 / drawing the last accepted body is deterministic and does no work",
	{texts: Texts},
	({texts}, ctx) =>
		Effect.gen(function* () {
			const draw = yield* drawingPresent;
			if (draw === null) return ctx.skip("not built: P22 drawing");
			const body = texts.at(-1) ?? "";
			exact(draw(body), draw(body));
		}),
	options,
);
it.prop(
	"checker controls/plants: independently expected histories catch metadata lost in every fold",
	{saves: SaveSequences},
	({saves}) => {
		const expected = history(saves);
		exact(structuredClone(expected), expected);
		// Ensure empty generated sequences also exercise every required metadata field.
		const row = {
			note: "note_0000000000e008000000000001",
			version: 1,
			body: "",
			how: "kept",
			from: {note: "note_0000000000e008000000000002", version: 0},
			by: "SHA256:exam-writer-0",
			arrivedAt: 0,
			sentAt: "2030-01-01T00:00:00Z",
			rev: 1,
		};
		for (const field of ["how", "from", "by", "arrivedAt", "sentAt"] as const) {
			const missing: Record<string, unknown> = {...row};
			delete missing[field];
			expect(() => exact([...expected, missing], [...expected, row])).toThrow();
		}
		expect(() =>
			exact([...expected, {...row, version: row.rev + 1}], [...expected, row]),
		).toThrow();
	},
	options,
);
it.prop(
	"presence controls: notes and every drawing path use the actual helper",
	{message: Arbitrary.schema(Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(128)))},
	({message}) => {
		const failed = () => {
			throw new Error(`partial or failed import: ${message}`);
		};
		const expectedDrawPaths = [
			"root.ts",
			"window.tsx",
			"draw.tsx",
			"drawn.tsx",
			"markdown.ts",
			"highlight.ts",
			"highlight.tsx",
			"highlighter.ts",
		].flatMap((file) => [
			`../../../../programs/notes/src/${file}`,
			`../../../../programs/notes/${file}`,
		]);
		expect(presence(drawingPaths, new Set(), failed, checkDrawing)).toBeNull();
		for (const p of expectedDrawPaths)
			expect(() => presence(drawingPaths, new Set([p]), failed, checkDrawing)).toThrow(
				"partial or failed import",
			);
		const draw = () => message;
		expect(presence(drawingPaths, new Set(expectedDrawPaths), () => draw, checkDrawing)).toBe(draw);
		expect(() =>
			presence(drawingPaths, new Set(expectedDrawPaths), () => undefined!, checkDrawing),
		).toThrow("missing drawing export");
		expect(presence(notesPaths, new Set(), failed, checkBound)).toBeNull();
		for (const p of [
			"../../../../programs/notes",
			"../../../../programs/notes/package.json",
			"../../../../programs/notes/src/program.ts",
			"../../../../programs/notes/program.ts",
		])
			expect(() => presence(notesPaths, new Set([p]), failed, checkBound)).toThrow(
				"partial or failed import",
			);
		const clean = {
			latest: () => ({bodies: [], cmds: [], initial: ""}),
			histories: () => ({live: [], replay: [], cuts: []}),
			machine,
			messages: () => [],
			encode: (x: unknown) => x,
			decode: (x: unknown) => x,
		};
		expect(presence(notesPaths, new Set(notesPaths), () => clean, checkBound)).toBe(clean);
		expect(() =>
			presence(
				notesPaths,
				new Set(notesPaths),
				() => ({...clean, histories: undefined!}),
				checkBound,
			),
		).toThrow("missing notes export");
	},
	options,
);

// These are checker controls, not notes. They exercise the real testing kit on a tiny tea machine.
const Model = Schema.Struct({body: Schema.String});
const Msg = Schema.Struct({type: Schema.Literal("show"), text: Schema.String});
const machine = Machine.make({
	model: Model,
	msg: Msg,
	cmds: [],
	init: (saved) => [saved ?? {body: ""}, []],
	update: {show: (_s, m) => [{body: m.text}, []]},
});
const ctx = stubCtxThrowingProxy<undefined>();
const check = (m: typeof machine, texts: ReadonlyArray<string>) => {
	let [s] = m.init(null, ctx);
	exact(s.body, "");
	for (const text of texts) {
		const [next, cmds] = applyCell(m, s, {type: "show", text});
		exact(next.body, text);
		exact(cmds, []);
		s = next;
	}
	syncTest(m, ctx, {
		msgs: texts.map((text) => ({type: "show", text}) as const),
		encode: Schema.encodeSync(Model),
		decode: Schema.decodeUnknownSync(Model),
		equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
		seed: SEED,
	});
};
it.prop(
	"checker clean control: real tea reducer and syncTest at every generated cut",
	{texts: Texts},
	({texts}) => {
		check(machine, texts);
	},
	options,
);
it.prop(
	"checker plants: keep-first, nonempty init, parsing Cmd and broken reload fail",
	{texts: Texts},
	({texts}) => {
		const first = "first",
			second = "second";
		const keepsFirst = {
			...machine,
			update: {
				show: (s: typeof Model.Type, m: typeof Msg.Type) =>
					[s.body ? s : {body: m.text}, []] as const,
			},
		};
		expect(() => check(keepsFirst, [first, second, ...texts])).toThrow();
		expect(() => check({...machine, init: () => [{body: "heading"}, []]}, texts)).toThrow();
		const brokenReload = {...machine, init: () => [{body: ""}, []] as const};
		expect(() => check(brokenReload, [first, ...texts])).toThrow(/syncTest/);
		expect(() => exact(["parse work"], [])).toThrow();
	},
	options,
);
