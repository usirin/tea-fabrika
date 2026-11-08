// T293, next/. Parent integration imports P14/P18's real machine. No substitute parent.
import {type Cmd, type Sub} from "@demlik/tea";
import {Machine} from "@demlik/tea/effect";
import {propertyInvariant} from "@demlik/tea/pbt";
import {Effect, Schema, Stream} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {Program} from "../app/program.ts";
import type {IdSchema} from "../data/id.ts";
import type {EditorWire, Sample} from "./editor.test-support.ts";

const load = async () => {
	const {windowMachine, WindowModel, WindowEvent, now, call, identify, startWindow, Letter} =
		await import("./window.ts");
	const {Identity} = await import("./key.ts");
	const {NoteEditor} = await import("./note-editor.ts");
	const support = await import("./editor.test-support.ts");
	const {ViewContract} = await import("./view.ts");
	const {Layout} = await import("./layout.ts");
	const {KeyTable} = await import("./keys.ts");
	const editor = NoteEditor.make(support.spec);
	const shared = Machine.make({
		model: support.spec.view,
		msg: Schema.Struct({type: Schema.Literal("save"), value: support.spec.save}),
		cmds: [],
		init: (loaded) => [loaded ?? {notes: []}, []],
		update: {save: (s) => [s, []]},
	});
	const program = Program.make({
		name: "notes",
		machine: shared,
		state: {v: 1, upgrades: []},
		view: (s) => s,
		inputs: {save: "Save"},
		outputs: {},
		writes: {},
		refuse: () => null,
		wake: () => null,
		tile: editor.machine,
		mode: editor.mode,
		commands: editor.commands,
	});
	const contract = ViewContract.make(program, {data: support.spec.view, commands: editor.commands});
	const context = (s: Sample) => {
		const tiles = s.ids.slice(0, 2).map((id) => `tile_${id.slice(5)}`);
		return {
			url: "ws://localhost:8787",
			views: {notes: contract},
			layout: Schema.decodeUnknownSync(Layout)({
				_tag: "split",
				dir: "row",
				parts: tiles.map((id, i) => ({
					percent: 50,
					inner: {_tag: "tile", id, name: `notes:${i + 1}`, keep: "failed"},
				})),
			}),
			keys: Schema.decodeUnknownSync(KeyTable)({
				prefix: "ctrl+b",
				ignore: [],
				tiles: {},
				modes: {},
				error: null,
			}),
		};
	};
	return {
		windowMachine,
		WindowModel,
		WindowEvent,
		now,
		call,
		identify,
		Identity,
		Letter,
		startWindow,
		...support,
		editor,
		context,
		contract,
	};
};
type Kit = Awaited<ReturnType<typeof load>>;
type Model = Kit["WindowModel"]["Type"];
type Event = Kit["WindowEvent"]["Type"];
const boot = (k: Kit, s: Sample, tabSuffix = k.first(s.ids).slice(5)) => {
	const context = k.context(s);
	const d = new k.Driver<Model, Event, Cmd, Sub, typeof context>(k.windowMachine, context);
	const identify = d.cmds.find((c) => c.type === k.identify.cmdType);
	expect(identify).toBeDefined();
	if (identify === undefined) throw new Error("Window must request its identity");
	d.send(
		k.identify.ok(
			identify,
			Schema.decodeUnknownSync(k.Identity)({
				key: "test-public",
				fingerprint: "SHA256:test",
				tab: `tab_${tabSuffix}`,
			}),
			0,
		),
	);
	d.send({type: "link", event: {type: "online", dial: 1, version: 1, ping: 0}});
	const call = d.cmds.find((c: Cmd & {method?: string}) => c.method === "window.open");
	expect(call).toBeDefined();
	if (call === undefined) throw new Error("Online must request window.open");
	const tiles = s.ids.slice(0, 2).map((id, i) => ({
		tile: `tile_${id.slice(5)}`,
		name: `notes:${i + 1}`,
		pid: `process_${id.slice(5)}`,
		program: "notes",
		hash: "test-hash",
	}));
	d.send({
		type: `${call.type}_ok`,
		cmd: call,
		at: 0,
		value: {
			client: {
				client: `client_${k.first(s.ids).slice(5)}`,
				session: `process_${k.first(s.ids.slice(1)).slice(5)}`,
			},
			tiles,
			keys: context.keys,
		},
	});
	for (const tile of tiles)
		d.send({
			type: "view",
			dial: 1,
			pid: tile.pid,
			hash: tile.hash,
			update: {
				type: "whole",
				rev: s.base * s.ids.length + s.ids.length * s.ids.length,
				ledger: s.seen,
				view: {notes: k.saved(s)},
			},
		});
	const first = k.first(tiles);
	const send = (m: Schema.Json, tile = first.tile) =>
		d.send({type: "tile", tile, m, via: {_tag: "click"}});
	send({type: "select", note: k.first(s.ids)});
	return {d, tiles, send, local: () => d.state.local[first.tile], first};
};

describe("P20 parent and editor", () => {
	it("L03 malformed local events are refused before the child update", async () => {
		const k = await load();
		fc.assert(
			fc.property(k.sample, fc.jsonValue(), (s, raw) => {
				const {d, send} = boot(k, s);
				send({type: "edit"});
				const before = d.state.local;
				expect(() =>
					send({type: "typed", body: {raw: Schema.decodeUnknownSync(Schema.Json)(raw)}}),
				).not.toThrow();
				expect(d.state.local).toEqual(before);
			}),
			k.options,
		);
	});
	it("L07 L14 stamping reserves one order and reconnect retries the exact frozen letter", async () => {
		const k = await load();
		fc.assert(
			fc.property(k.sample, fc.array(k.text, {minLength: 1, maxLength: 8}), (s, bodies) => {
				const {d, send, first} = boot(k, s);
				send({type: "edit"});
				send({type: "typed", body: s.draft});
				send({type: "done"});
				const pending = d.state.pending;
				expect(pending).toHaveLength(1);
				for (const body of bodies) {
					send({type: "typed", body});
					send({type: "done"});
				}
				expect(d.state.pending).toHaveLength(1);
				const stamp = d.cmds.find((c: Cmd) => c.type === k.now.cmdType);
				expect(stamp).toBeDefined();
				if (stamp === undefined) throw new Error("Save must request a stamp");
				const expected = k.frozen(s);
				d.send(k.now.ok(stamp, {id: expected.id, sentAt: expected.sentAt}, 0));
				const ready = k.first(d.state.pending);
				expect(ready).toMatchObject({
					_tag: "ready",
					tile: first.tile,
					letter: {
						id: expected.id,
						seen: s.seen,
						sentAt: expected.sentAt,
						m: {type: "save", value: {body: s.draft, base: s.base}},
					},
				});
				const letter = ready.letter;
				d.send({type: "link", event: {type: "closed", dial: 1, code: 1006, at: 0}});
				d.send({type: "link", event: {type: "online", dial: 2, version: 1, ping: 0}});
				expect(k.first(d.state.pending).letter).toEqual(letter);
				const sends = d.cmds.filter((c: Cmd & {method?: string}) => c.method === "process.send");
				expect(sends.length).toBeGreaterThanOrEqual(2);
				const controlled = Effect.runSync(k.wire());
				const transport: EditorWire = controlled;
				for (const out of sends) {
					expect(out).toMatchObject({
						params: {
							pid: letter.pid,
							letter: letter.id,
							m: letter.m,
							seen: letter.seen,
							sentAt: letter.sentAt,
							action: letter.action,
						},
					});
					const params = Schema.decodeUnknownSync(
						Schema.Struct({
							pid: Schema.String,
							letter: Schema.String,
							m: Schema.Json,
							seen: Schema.Int,
							sentAt: Schema.String,
							action: Schema.Json,
						}),
					)((out as Cmd & {readonly params: unknown}).params);
					Effect.runSync(
						controlled.write(Schema.decodeUnknownSync(k.Letter)({...params, id: params.letter})),
					);
				}
				expect(Effect.runSync(transport.sent)).toEqual(sends.map(() => letter));
				const mutant = k.planted(
					k.windowMachine,
					(_p: Model, m: Event, n: Model, c: ReadonlyArray<Cmd>) =>
						m.type === "tile" && m.m.type === "done"
							? [{...n, pending: [...n.pending, k.first(n.pending)]}, c]
							: [n, c],
				);
				const seq = fc.constant(d.msgs);
				const check = ({next}: {next: Model}) => next.pending.length <= 1;
				propertyInvariant(k.windowMachine, k.context(s), seq, check, {...k.options, numRuns: 1});
				expect(() =>
					propertyInvariant(mutant, k.context(s), seq, check, {...k.options, numRuns: 1}),
				).toThrow();
				const sameLetter = ({prev, msg, next}: {prev: Model; msg: Event; next: Model}) => {
					if (
						msg.type !== "link" ||
						msg.event.type !== "online" ||
						!prev.pending.some((p: Model["pending"][number]) => p._tag === "ready")
					)
						return true;
					expect(next.pending).toEqual(prev.pending);
					return true;
				};
				const restamped = k.planted(
					k.windowMachine,
					(_p: Model, m: Event, n: Model, c: ReadonlyArray<Cmd>) =>
						m.type === "link" && m.event.type === "online"
							? [
									{
										...n,
										pending: n.pending.map((p: Model["pending"][number]) =>
											p._tag === "ready"
												? {
														...p,
														letter: {
															...p.letter,
															seen: p.letter.seen + 1,
															sentAt: "2026-11-09T00:00:00Z",
														},
													}
												: p,
										),
									},
									c,
								]
							: [n, c],
				);
				propertyInvariant(k.windowMachine, k.context(s), seq, sameLetter, {
					...k.options,
					numRuns: 1,
				});
				expect(() =>
					propertyInvariant(restamped, k.context(s), seq, sameLetter, {...k.options, numRuns: 1}),
				).toThrow();
			}),
			k.options,
		);
	});
	it("L21 independent tiles and windows retain modes and drafts across focus, fold and reveal", async () => {
		const k = await load();
		fc.assert(
			fc.property(k.sample, fc.array(fc.boolean(), {minLength: 1, maxLength: 10}), (s, folds) => {
				const a = boot(k, s),
					b = boot(k, s, k.first(s.ids.slice(1)).slice(5)),
					other = k.first(a.tiles.slice(1));
				a.send({type: "edit"});
				a.send({type: "typed", body: s.draft});
				const edited = a.local(),
					untouched = a.d.state.local[other.tile];
				for (const folded of folds) {
					a.d.send({type: "focus", tile: other.tile});
					a.d.send({type: "resized", width: folded ? 180 : 1200, height: 700});
					a.d.send({type: "focus", tile: a.first.tile});
					expect(a.local()).toBe(edited);
					expect(a.d.state.local[other.tile]).toBe(untouched);
					expect(k.editor.mode(a.local())).toBe("editing");
					expect(k.editor.mode(b.local())).toBeNull();
				}
				const mutant = k.planted(
					k.windowMachine,
					(_p: Model, m: Event, n: Model, c: ReadonlyArray<Cmd>) =>
						m.type === "resized" ? [{...n, local: {}}, c] : [n, c],
				);
				const check = ({prev, msg, next}: {prev: Model; msg: Event; next: Model}) =>
					msg.type !== "resized" || next.local[a.first.tile] === prev.local[a.first.tile];
				propertyInvariant(k.windowMachine, k.context(s), fc.constant(a.d.msgs), check, {
					...k.options,
					numRuns: 1,
				});
				expect(() =>
					propertyInvariant(mutant, k.context(s), fc.constant(a.d.msgs), check, {
						...k.options,
						numRuns: 1,
					}),
				).toThrow();
			}),
			k.options,
		);
	});
	it("L20 good key reload disarms prefix; bad reload retains the last good keys", async () => {
		const k = await load();
		const {readKeys} = await import("./keys.ts");
		fc.assert(
			fc.property(k.sample, fc.constantFrom("a", "q", "x"), (s, key) => {
				const {d} = boot(k, s);
				const good = Effect.runSync(
					readKeys(`[notes.keys]\nedit = "${key}"`, d.state.keys, {
						notes: {commands: k.editor.commands, modes: ["editing"]},
					}),
				);
				d.send({type: "keys", table: good});
				expect(d.state.prefix).toBe(false);
				const retained = d.state.keys;
				d.send({
					type: "keys",
					table: {...good, error: {line: 2, message: "Unknown command"}, tiles: {}},
				});
				expect(d.state.keys.tiles).toEqual(retained.tiles);
			}),
			k.options,
		);
	});
	it("L11 configured timer waits the drawn interval under TestClock", async () => {
		const k = await load();
		const {ClientConnection} = await import("./connection.ts");
		const {ClientKey, Identity} = await import("./key.ts");
		const {IdGenerator, IdError} = await import("../data/id.ts");
		// startWindow owns the timer Sub. The test services control its clock and outside answers.
		await fc.assert(
			fc.asyncProperty(k.sample, fc.integer({min: 2, max: 5000}), async (s, pauseMs) => {
				const {d, first} = boot(k, s),
					writes: Schema.Json[] = [];
				const identity = Schema.decodeUnknownSync(Identity)({
					key: "test-public",
					fingerprint: "SHA256:test",
					tab: `tab_${k.first(s.ids).slice(5)}`,
				});
				const memory = Effect.gen(function* () {
					const runtime = yield* k.startWindow({
						...k.context(s),
						identity,
						editor: {pauseMs},
					});
					for (const msg of d.msgs) yield* runtime.dispatch(msg);
					runtime.send({type: "tile", tile: first.tile, via: {_tag: "click"}, m: {type: "edit"}});
					runtime.send({
						type: "tile",
						tile: first.tile,
						via: {_tag: "click"},
						m: {type: "typed", body: s.draft},
					});
					yield* runtime.idle();
					yield* TestClock.adjust(`${pauseMs - 1} millis`);
					expect(writes).toEqual([]);
					yield* TestClock.adjust("1 millis");
					expect(writes).toHaveLength(1);
				}).pipe(
					Effect.scoped,
					Effect.provideService(ClientConnection, {
						request: (method: string, params: Schema.Json) =>
							Effect.sync(() => {
								if (method === "process.send") writes.push(params);
								return {_tag: "accepted", rev: 1, pos: 1};
							}),
						news: Stream.empty,
						events: Stream.empty,
						open: () => Effect.void,
						ping: () => Effect.void,
						close: Effect.void,
					}),
					Effect.provideService(ClientKey, {
						identity: Effect.succeed(identity),
						replace: Effect.succeed(identity),
						sign: () => Effect.succeed("test-signature"),
						changes: Stream.empty,
						persist: Effect.void,
					}),
					Effect.provideService(IdGenerator, {
						next: <K extends string>(schema: IdSchema<K>) =>
							Schema.decodeUnknownEffect(schema)(
								`${schema.prefix}_${k.first(s.ids).slice(5)}`,
							).pipe(Effect.mapError(() => new IdError({why: "entropy"}))),
					}),
				);
				await Effect.runPromise(memory.pipe(Effect.provide(TestClock.layer())));
			}),
			k.options,
		);
	});
	it("L27 real parent emits action, retry and refusal observations with no note text", async () => {
		const k = await load();
		const {ClientObservation} = await import("./recording.ts");
		fc.assert(
			fc.property(k.sample, fc.constantFrom("changed_elsewhere", "too_long"), (s, why) => {
				const {d, send} = boot(k, s);
				send({type: "edit"});
				send({type: "typed", body: s.draft});
				send({type: "done"});
				const stamp = d.cmds.find((c) => c.type === k.now.cmdType);
				expect(stamp).toBeDefined();
				if (stamp === undefined) throw new Error("Save must stamp");
				const letter = k.frozen(s);
				d.send(k.now.ok(stamp, {id: letter.id, sentAt: letter.sentAt}, 0));
				d.send({type: "link", event: {type: "closed", dial: 1, code: 1006, at: 1}});
				d.send({type: "link", event: {type: "online", dial: 2, version: 1, ping: 1}});
				const delivery = d.cmds
					.filter((c: Cmd & {method?: string}) => c.method === "process.send")
					.at(-1);
				expect(delivery).toBeDefined();
				if (delivery === undefined) throw new Error("Reconnect must retry");
				d.send(k.call.ok(delivery, {_tag: "refused", why, now: s.base + 1, most: 256}, 1));
				const observations = d.cmds
					.filter((c: Cmd & {method?: string}) => c.method === "client.observe")
					.map((c: Cmd & {params?: {observation: unknown}}) =>
						Schema.decodeUnknownSync(ClientObservation)(c.params?.observation),
					);
				expect(observations).toEqual(
					expect.arrayContaining([
						expect.objectContaining({_tag: "note.action", command: "edit"}),
						expect.objectContaining({_tag: "note.action", command: "done"}),
						expect.objectContaining({_tag: "sent", letter: letter.id, tries: 2}),
						expect.objectContaining({_tag: "settled", letter: letter.id, answer: "refused", why}),
					]),
				);
				for (const observation of observations) {
					const encoded = Schema.encodeSync(ClientObservation)(observation);
					expect(encoded).not.toHaveProperty("body");
					expect(encoded).not.toHaveProperty("title");
					expect(encoded).not.toHaveProperty("frame");
				}
			}),
			k.options,
		);
	});
	it("L30 a library-only client drives the same edit, retry, refusal and history decisions", async () => {
		const publicApi = await import("@kampus/libfabrika");
		const k = await load();
		expect(publicApi.windowMachine).toBe(k.windowMachine);
		expect(publicApi.NoteEditor).toBeDefined();
		fc.assert(
			fc.property(k.sample, (s) => {
				const {d, send, local} = boot({...k, windowMachine: publicApi.windowMachine}, s);
				send({type: "edit"});
				send({type: "typed", body: s.draft});
				expect(publicApi.NoteEditor.make(k.spec).mode(local())).toBe("editing");
				send({type: "done"});
				const stamp = d.cmds.find((c) => c.type === k.now.cmdType);
				expect(stamp).toBeDefined();
				if (stamp === undefined) throw new Error("The public client must stamp its save");
				const letter = k.frozen(s);
				d.send(k.now.ok(stamp, {id: letter.id, sentAt: letter.sentAt}, 0));
				d.send({type: "link", event: {type: "closed", dial: 1, code: 1006, at: 0}});
				d.send({type: "link", event: {type: "online", dial: 2, version: 1, ping: 0}});
				const delivery = d.cmds
					.filter((c: Cmd & {method?: string}) => c.method === "process.send")
					.at(-1);
				expect(delivery).toBeDefined();
				if (delivery === undefined) throw new Error("The public client must retry its save");
				d.send(
					k.call.ok(delivery, {_tag: "refused", why: "changed_elsewhere", now: s.base + 1}, 0),
				);
				expect(local().boxes[k.first(s.ids)]).toMatchObject({_tag: "stale", draft: s.draft});
				send({type: "history"});
				send({type: "read_failed"});
				send({type: "retry"});
				expect(local().boxes[k.first(s.ids)].draft).toBe(s.draft);
				expect(d.cmds.length).toBeGreaterThan(0);
			}),
			k.options,
		);
	});
});
