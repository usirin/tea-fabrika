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
const options = {arbitrary: {seed: SEED, runs: 300, size: 4096, concurrency: 1}};
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
const Bases = Arbitrary.schema(
	Schema.Struct({
		branch: Schema.Literals(["version", "negative", "fractional", "future"]),
		n: int(0, 64),
		numerator: int(-64, 64),
		denominator: int(2, 8),
	}),
).pipe(
	Arbitrary.map((b) =>
		b.branch === "negative"
			? -Math.max(1, b.n)
			: b.branch === "fractional"
				? b.numerator / b.denominator
				: b.branch === "future"
					? b.n + 65
					: b.n,
	),
);
// Base branches are explicit and stay bounded while shrinking.
const SaveSequences = Arbitrary.array(
	Arbitrary.all({
		note: Arbitrary.schema(int(0, 7)),
		writer: Arbitrary.schema(int(0, 7)),
		body: Arbitrary.schema(Text),
		base: Bases,
		clock: Arbitrary.schema(int(0, 281474976710655)),
		rev: Arbitrary.schema(int(0, 4096)),
		how: Arbitrary.schema(Schema.Literals(["pause", "leave", "done", "kept", "agent"])),
	}),
	{minLength: 0, maxLength: 32},
);
type Sequence = typeof SaveSequences extends Arbitrary.Arbitrary<infer S> ? S : never;
const exact = (actual: unknown, expected: unknown) => expect(actual).toEqual(expected);

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
const present = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	return yield* fs.exists(new URL("../../../../programs/notes", import.meta.url).pathname);
}).pipe(Effect.provide(NodeFileSystem.layer));
const drawingPresent = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	for (const file of ["root.ts", "window.tsx", "draw.tsx", "markdown.ts", "highlight.ts"])
		if (
			yield* fs.exists(new URL(`../../../../programs/notes/src/${file}`, import.meta.url).pathname)
		)
			return true;
	return false;
}).pipe(Effect.provide(NodeFileSystem.layer));
const drawBinding = (): ((body: string) => unknown) => {
	throw new Error("P22 started: bind real drawing");
};

it.effect.prop(
	"not built: P13 / latest accepted text replaces all earlier text, empty from init, no parsing work",
	{texts: Texts},
	({texts}, ctx) =>
		Effect.gen(function* () {
			if (!(yield* present)) ctx.skip("not built: P13 notes");
			const actual = bind().latest(texts);
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
			if (!(yield* present)) ctx.skip("not built: P13 notes");
			const d = bind(),
				actual = d.histories(saves);
			exact(actual.replay, actual.live);
			expect(actual.cuts).toHaveLength(saves.length + 1);
			for (const cut of actual.cuts) exact(cut, actual.live);
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
			if (!(yield* drawingPresent)) ctx.skip("not built: P22 drawing");
			const draw = drawBinding(),
				body = texts.at(-1) ?? "";
			exact(draw(body), draw(body));
		}),
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
