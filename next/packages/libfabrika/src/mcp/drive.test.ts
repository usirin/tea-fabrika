import {Machine} from "@demlik/tea/effect";
// P25 C/D, next/. Generic drive laws use a Program.make fixture, never claim P13 integration.
import {expect, it} from "@effect/vitest";
import {Cause, Context, Effect, Exit, Layer, PubSub, Ref, Schema, Stream, type Scope} from "effect";
import * as fc from "fast-check";
import {Program} from "../app/program.ts";
import * as Id from "../id.ts";
import {Hello, Who} from "../transport/wire.ts";
import {
	ClientState,
	Delivery,
	Save,
	Small,
	clientFixture,
	fixtureLayer,
	notesFixture,
	options,
	process,
	storeFixture,
	text,
	type DriveModule,
	type McpReply,
	type AnyProgram,
} from "./mcp.test-support.ts";

const actual = Effect.promise((): Promise<DriveModule> => import("./drive.ts"));
// Exact P18 extension of P14's client/connection.ts. Only test Layers remain when it lands.
class ClientDown extends Schema.TaggedError<ClientDown>()("ClientDown", {
	why: Schema.Literals([
		"closed",
		"removed",
		"timeout",
		"bad_frame",
		"bad_reply",
		"no_version",
		"storage",
	]),
}) {}
const ConnectionEvent = Schema.TaggedUnion({
	opened: {dial: Schema.Int},
	pong: {dial: Schema.Int},
	closed: {dial: Schema.Int, code: Schema.Int},
});
const Initialized = Schema.TaggedUnion({
	online: {who: Who, version: Schema.Int, ping: Schema.Number, hello: Hello},
});
class ClientConnection extends Context.Service<
	ClientConnection,
	{
		readonly request: (
			method: string,
			params: Schema.Json,
		) => Effect.Effect<Schema.Json, ClientDown>;
		readonly news: Stream.Stream<
			{readonly method: string; readonly params: Schema.Json},
			ClientDown
		>;
		readonly open: (dial: number) => Effect.Effect<void, ClientDown, Scope.Scope>;
		readonly ping: (dial: number) => Effect.Effect<void, ClientDown>;
		readonly events: Stream.Stream<typeof ConnectionEvent.Type, ClientDown>;
		readonly close: Effect.Effect<void>;
	}
>()("@kampus/libfabrika/ClientConnection") {}
const clientConnectionFixture = (raw: Schema.Json) =>
	Effect.gen(function* () {
		const news = yield* PubSub.unbounded<{readonly method: string; readonly params: Schema.Json}>();
		const events = yield* PubSub.unbounded<typeof ConnectionEvent.Type>();
		return {
			options: {
				url: "ws://127.0.0.1:1/door",
				identity: {
					key: "test-key",
					fingerprint: "test-key",
					tab: Id.Tab.make("tab_0000000000e008000000000000"),
				},
				name: "test",
				label: "test",
				os: "linux" as const,
				has: [],
				build: "test",
				sign: () => Effect.succeed("test-signature"),
			},
			layer: Layer.succeed(ClientConnection, {
				request: Effect.fn("test.clientRequest")(function* (method, params) {
					if (method === "initialize") {
						const hello = yield* Schema.decodeUnknownEffect(Hello)(params).pipe(
							Effect.mapError(() => new ClientDown({why: "bad_reply"})),
						);
						return Initialized.cases.online.make({
							hello,
							who: {key: "test-key", person: "person", as: "agent"},
							version: 1,
							ping: 10000,
						});
					}
					if (method === "process.info") return [];
					return {corrupt: raw};
				}),
				news: Stream.fromPubSub(news),
				open: (dial: number) =>
					PubSub.publish(events, ConnectionEvent.cases.opened.make({dial})).pipe(
						Effect.andThen(
							PubSub.publish(news, {method: "challenge", params: {nonce: "test-nonce", dial}}),
						),
						Effect.asVoid,
					),
				ping: () => Effect.void,
				events: Stream.fromPubSub(events),
				close: Effect.void,
			}),
		};
	});

const retryProgramFixture = (): AnyProgram => {
	const Model = Schema.Struct({body: Schema.String, version: Small});
	const msg = Schema.Union([
		Schema.Struct({type: Schema.Literal("save"), value: Save}),
		Schema.Struct({type: Schema.Literal("extra"), value: Save}),
	]);
	const machine = Machine.make({
		model: Model,
		msg,
		cmds: [],
		init: (s) => [s ?? {body: "", version: 0}, []],
		update: {save: (s) => [s, []], extra: (s) => [s, []]},
	});
	return Program.make({
		name: "notes",
		machine,
		state: {v: 1, upgrades: []},
		view: (m) => m,
		refuse: () => null,
		inputs: {save: "Save", extra: "Another declared save port"},
		outputs: {},
		writes: {},
		wake: () => null,
	});
};
const readLaw = (reply: McpReply, body: string, note: string, sends: ReadonlyArray<unknown>) => {
	expect(reply.isError).not.toBe(true);
	expect(JSON.parse(text(reply))).toEqual({body, version: 1, note});
	expect(sends).toEqual([]);
};
it.effect.prop(
	"L12 reads call the declared answer on each fresh checked view without a letter",
	{body: Schema.String, next: Schema.String, note: Schema.String},
	({body, next, note}) =>
		Effect.gen(function* () {
			const f = yield* clientFixture();
			const store = yield* storeFixture();
			const drive = yield* (yield* actual)
				.driveFor([notesFixture()], f.client)
				.pipe(Effect.provide(store.layer));
			for (const current of [body, next]) {
				yield* f.setView({body: current, version: 1});
				readLaw(yield* drive.call("notes_read", {value: {note}}), current, note, yield* f.requests);
			}
		}).pipe(Effect.provide(fixtureLayer)),
	options,
);
it.effect.prop(
	"L12 writes send the decoded Msg and return a fresh view with its placing",
	{save: Save},
	({save}) =>
		Effect.gen(function* () {
			const f = yield* clientFixture(),
				store = yield* storeFixture();
			const view = {body: save.body, version: save.base + 1};
			const client = {
				...f.client,
				send: (r: Parameters<typeof f.client.send>[0]) =>
					f.client.send(r).pipe(Effect.tap(() => f.setView(view))),
			};
			const drive = yield* (yield* actual)
				.driveFor([notesFixture()], client)
				.pipe(Effect.provide(store.layer));
			const reply = yield* drive.call("notes_save", {value: save});
			expect(reply.isError).not.toBe(true);
			expect((yield* f.requests)[0]).toMatchObject({m: {type: "save", value: save}});
			expect(text(reply)).toContain(JSON.stringify(view));
			expect(text(reply)).toContain('"pos":1');
		}).pipe(Effect.provide(fixtureLayer)),
	options,
);
const ReadAnswer = Schema.TaggedUnion({
	found: {note: Schema.String, version: Schema.Number, body: Schema.String},
});
it.effect.prop(
	"L12 real P13 read ports use changing checked notes views without an inbox letter",
	{body: Schema.String, next: Schema.String, version: Small},
	({body, next, version}) =>
		Effect.gen(function* () {
			const {notes, Notes} = yield* Effect.promise(() => import("@kampus/notes"));
			const note = yield* Id.Generator.use((g) => g.next(Id.make("note")));
			const f = yield* clientFixture(),
				store = yield* storeFixture();
			const drive = yield* (yield* actual)
				.driveFor([notes], f.client)
				.pipe(Effect.provide(store.layer));
			for (const current of [body, next]) {
				const model = yield* Schema.decodeUnknownEffect(Notes)({
					notes: [{note, body: current, version: version + 1}],
				});
				yield* f.setView(Schema.encodeUnknownSync(Schema.Json)(notes.view.select(model)));
				const reply = yield* drive.call("notes_read", {value: {note}});
				expect(reply.isError).not.toBe(true);
				expect(JSON.parse(text(reply))).toEqual(
					ReadAnswer.cases.found.make({note, body: current, version: version + 1}),
				);
				expect(yield* f.requests).toEqual([]);
			}
		}).pipe(Effect.provide(fixtureLayer)),
	options,
);
it.effect.prop(
	"calls serialize through one permit",
	{bodies: Schema.Array(Schema.String).check(Schema.isMinLength(2), Schema.isMaxLength(16))},
	({bodies}) =>
		Effect.gen(function* () {
			const f = yield* clientFixture(),
				store = yield* storeFixture();
			const active = yield* Ref.make(0),
				maximum = yield* Ref.make(0);
			const client = {
				...f.client,
				send: (r: Parameters<typeof f.client.send>[0]) =>
					Effect.gen(function* () {
						const n = yield* Ref.updateAndGet(active, (n) => n + 1);
						yield* Ref.update(maximum, (m) => Math.max(m, n));
						yield* Effect.yieldNow;
						return yield* f.client.send(r);
					}).pipe(Effect.ensuring(Ref.update(active, (n) => n - 1))),
			};
			const drive = yield* (yield* actual)
				.driveFor([notesFixture()], client)
				.pipe(Effect.provide(store.layer));
			yield* Effect.forEach(
				bodies,
				(body, i) => drive.call("notes_save", {value: {note: `n${i}`, base: 0, body}}),
				{concurrency: 16},
			);
			expect(yield* Ref.get(maximum)).toBe(1);
		}).pipe(Effect.provide(fixtureLayer)),
	options,
);
const staleLaw = (reply: McpReply, now: number, most: number) => {
	expect(reply.isError).toBe(true);
	expect(text(reply)).toContain(
		`changed_elsewhere: this note is on version ${now}. Read it, then save on that.`,
	);
	// Terminal numbers may be rendered as structured JSON as well as the shared sentence.
	expect(text(reply)).toContain(String(most));
};
it.effect.prop(
	"L13 stale refusal preserves why, now, most and window wording",
	{save: Save, now: Small, most: Small},
	({save, now, most}) =>
		Effect.gen(function* () {
			// The real notes and shared formatter are required here. These stay parent-red.
			const {notes} = yield* Effect.promise(() => import("@kampus/notes"));
			const {formatRefusal} = yield* Effect.promise(() => import("../app/refusal.ts"));
			const f = yield* clientFixture();
			const store = yield* storeFixture();
			yield* f.setDelivery(Delivery.cases.refused.make({why: "changed_elsewhere", now, most}));
			const drive = yield* (yield* actual)
				.driveFor([notes], f.client)
				.pipe(Effect.provide(store.layer));
			const note = yield* Id.Generator.use((g) => g.next(Id.make("note")));
			const fromNote = yield* Id.Generator.use((g) => g.next(Id.make("note")));
			const reply = yield* drive.call("notes_save", {
				value: {
					...save,
					note,
					...(save.from
						? {from: {...save.from, note: fromNote, version: Math.max(1, save.from.version)}}
						: {}),
					base: now + 1,
				},
			});
			staleLaw(reply, now, most);
			expect(text(reply)).toContain(formatRefusal({why: "changed_elsewhere", now, most}));
		}).pipe(Effect.provide(fixtureLayer)),
	options,
);

const digestLaw = (a: string, reordered: string, changed: ReadonlyArray<string>) => {
	expect(a).toMatch(/^[a-f0-9]{64}$/);
	expect(reordered, "object order is not save intent").toBe(a);
	for (const digest of changed)
		expect(digest, "every decoded argument binds the receipt").not.toBe(a);
};
// Object-key permutations have no schema operation. Only this operation uses fast-check.
const reorder = (value: Schema.Json, ranks: ReadonlyArray<number>): Schema.Json => {
	if (Array.isArray(value)) return value.map((v) => reorder(v, ranks));
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.map(([k, v], i) => ({k, v, i}))
			.sort((a, b) => (ranks[a.i % ranks.length] ?? 0) - (ranks[b.i % ranks.length] ?? 0))
			.map(({k, v}) => [k, reorder(v, ranks)]),
	);
};
it.effect.prop(
	"L15 canonical digest binds arguments, optional fields, checked key and continuing target",
	{save: Save},
	({save}) =>
		Effect.gen(function* () {
			const f = yield* clientFixture();
			const store = yield* storeFixture();
			const api = yield* actual;
			const captured: string[] = [];
			const make = () =>
				api.driveFor([retryProgramFixture()], f.client).pipe(Effect.provide(store.layer));
			const drive = yield* make();
			const value = {...save, how: "kept" as const, from: {note: save.note, version: 1}};
			yield* drive.call("notes_save", {value});
			const first = (yield* store.receipts)[0]!;
			const permutations = fc.sample(fc.array(fc.integer(), {minLength: 1, maxLength: 16}), {
				seed: 119120,
				numRuns: 20,
			});
			for (const ranks of permutations) yield* drive.call("notes_save", reorder({value}, ranks));
			expect(yield* store.receipts).toHaveLength(1);
			const variants = [
				{...value, body: `${value.body}\u0000`},
				{...value, base: (value.base + 1) % 10001},
				{...value, note: `${value.note}x`},
				{...value, how: "done"},
				{...value, from: {...value.from, version: 2}},
				{...value, from: {...value.from, note: `${value.note}x`}},
			];
			for (const variant of variants) {
				const before = (yield* store.receipts).length;
				expect((yield* drive.call("notes_save", {value: variant})).isError).not.toBe(true);
				expect(yield* store.receipts).toHaveLength(before + 1);
				captured.push((yield* store.receipts).at(-1)!.digest);
			}
			const beforeInput = (yield* store.receipts).length;
			expect((yield* drive.call("notes_extra", {value})).isError).not.toBe(true);
			expect(yield* store.receipts).toHaveLength(beforeInput + 1);
			captured.push((yield* store.receipts).at(-1)!.digest);
			yield* f.setState(
				ClientState.cases.online.make({key: "other-agent", person: "checked-person"}),
			);
			yield* (yield* make()).call("notes_save", {value});
			captured.push((yield* store.receipts).at(-1)!.digest);
			const moved = {
				...f.client,
				ps: Effect.succeed([
					{
						process: Id.Process.make("process_0000000000e008000000000001"),
						name: "notes:2",
						program: "notes",
						build: "next",
						restarts: 0,
					},
				]),
			};
			yield* (yield* api
				.driveFor([retryProgramFixture()], moved)
				.pipe(Effect.provide(store.layer))).call("notes_save", {value});
			captured.push((yield* store.receipts).at(-1)!.digest);
			yield* f.setState(
				ClientState.cases.online.make({key: "checked-agent", person: "checked-person"}),
			);
			const beforeRestart = (yield* store.receipts).length;
			const restarted = {
				...f.client,
				ps: Effect.succeed([
					{
						process: Id.Process.make("process_0000000000e008000000000001"),
						name: "notes:1",
						program: "notes",
						build: "next",
						restarts: 1,
					},
				]),
			};
			yield* (yield* api
				.driveFor([retryProgramFixture()], restarted)
				.pipe(Effect.provide(store.layer))).call("notes_save", {value});
			expect(yield* store.receipts).toHaveLength(beforeRestart);
			digestLaw(first.digest, (yield* store.receipts)[0]!.digest, captured);
			for (const r of yield* store.receipts) {
				expect(Object.keys(r).sort()).toEqual([
					"answer",
					"digest",
					"key",
					"ledger",
					"letter",
					"seen",
					"sentAt",
					"target",
				]);
				expect(r.letter).toMatch(/^letter_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
			}
		}).pipe(Effect.provide(fixtureLayer)),
	options,
);
it.effect.prop(
	"L05 malformed replies fail in the typed channel and valid replies work",
	{raw: Schema.Json},
	({raw}) =>
		Effect.gen(function* () {
			const {startClient} = yield* Effect.promise(() => import("./client.ts"));
			const fixture = yield* clientConnectionFixture(raw);
			const exit = yield* Effect.exit(
				Effect.gen(function* () {
					const client = yield* startClient(fixture.options);
					const state = yield* client.state;
					if (state._tag !== "online")
						yield* Stream.runHead(
							client.changes.pipe(
								Stream.filter(
									(s: {readonly _tag: string}) => s._tag === "online" || s._tag === "failed",
								),
							),
						);
					expect(yield* client.ps).toEqual([]);
					return yield* client.open(process);
				}).pipe(Effect.provide(fixture.layer)),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false);
		}),
	options,
);
it.effect.prop(
	"connection failure cannot become a successful tool reply",
	{save: Save},
	({save}) =>
		Effect.gen(function* () {
			const {BridgeDown} = yield* Effect.promise(() => import("./client.ts"));
			const f = yield* clientFixture();
			const store = yield* storeFixture();
			const drive = yield* (yield* actual)
				.driveFor([notesFixture()], {
					...f.client,
					open: () => Effect.fail(new BridgeDown({why: "connection"})),
				})
				.pipe(Effect.provide(store.layer));
			const exit = yield* Effect.exit(drive.call("notes_save", {value: save}));
			expect(Exit.isFailure(exit)).toBe(true);
		}).pipe(Effect.provide(fixtureLayer)),
	options,
);
it("plant L12: reads routed through inbox", () => {
	expect(() =>
		readLaw(
			{content: [{type: "text", text: JSON.stringify({body: "b", version: 1, note: "n"})}]},
			"b",
			"n",
			[1],
		),
	).toThrow();
});
it("plant L13: refusal replaced by bad_msg or success", () => {
	for (const reply of [
		{isError: true, content: [{type: "text" as const, text: "bad_msg"}]},
		{content: [{type: "text" as const, text: "saved"}]},
	])
		expect(() => staleLaw(reply, 5, 10)).toThrow();
});
it("plant L15: insertion order hash and omitted arguments", () => {
	expect(() => digestLaw("a".repeat(64), "b".repeat(64), [])).toThrow();
	expect(() => digestLaw("a".repeat(64), "a".repeat(64), ["a".repeat(64)])).toThrow();
});
