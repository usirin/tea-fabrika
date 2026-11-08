// T293, next/. Every law boots the real editor. Plants alter its real transitions.
import {type Cmd, type Sub} from "@demlik/tea";
import {propertyInvariant} from "@demlik/tea/pbt";
import {Effect, Result, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {Entry, lineFor} from "../data/log.ts";
import {syncTest} from "../testing.ts";
import type {Sample} from "./editor.test-support.ts";

const load = async () => {
	const {NoteEditor} = await import("./note-editor.ts");
	const support = await import("./editor.test-support.ts");
	const editor = NoteEditor.make(support.spec);
	const Model: Schema.Codec<typeof editor.Model.Type, unknown> = editor.Model;
	const Event: Schema.Codec<typeof editor.Event.Type, unknown> = editor.Event;
	return {...support, editor: {...editor, Model, Event}, NoteEditor};
};
type Kit = Awaited<ReturnType<typeof load>>;
type Model = Kit["editor"]["Model"]["Type"];
type Event = Kit["editor"]["Event"]["Type"];
type Mutation = (
	prev: Model,
	msg: Event,
	next: Model,
	cmds: ReadonlyArray<Cmd>,
) => readonly [Model, ReadonlyArray<Cmd>];
const law = (name: string, mutation: Mutation, prove: (kit: Kit, mutant: boolean) => void) => {
	it(name, async () => prove(await load(), false));
	it(`plant: ${name}`, async () => {
		const kit = await load();
		// Load and boot outside toThrow. Missing product code is never plant success.
		kit.editor.machine.init(null, {});
		prove(kit, false);
		const machine = kit.planted(kit.editor.machine, mutation);
		expect(() => prove({...kit, editor: {...kit.editor, machine}}, true)).toThrow();
	});
};
const drive = (k: Kit) =>
	new k.Driver<Model, Event, Cmd, Sub, Record<never, never>>(k.editor.machine, {});
type Drive = ReturnType<typeof drive>;
const open = (k: Kit, d: Drive, s: Sample, edit = true) => {
	const notes = k.saved(s);
	d.send({type: "view", notes});
	d.send({type: "select", note: k.first(s.ids)});
	if (edit) d.send({type: "edit"});
	return notes;
};
const box = (k: Kit, d: Drive, s: Sample) => d.state.boxes[k.first(s.ids)];
const begin = (k: Kit, d: Drive, s: Sample) => {
	open(k, d, s);
	d.send({type: "typed", body: `${s.body}0${s.draft}`});
	d.send({type: "done"});
	expect(box(k, d, s)._tag).toBe("preparing");
	const letter = k.frozen(s, k.first(s.ids), `${s.body}0${s.draft}`);
	d.send({type: "stamped", note: k.first(s.ids), letter});
	expect(box(k, d, s)._tag).toBe("saving");
	return letter;
};
const accept = (k: Kit, d: Drive, s: Sample, letter: ReturnType<Kit["frozen"]>) =>
	d.send({
		type: "answer",
		note: k.first(s.ids),
		letter: letter.id,
		answer: {_tag: "accepted", rev: s.seen + 1, pos: s.base + 1},
	});
const stale = (k: Kit, d: Drive, s: Sample) => {
	const letter = begin(k, d, s);
	d.send({
		type: "answer",
		note: k.first(s.ids),
		letter: letter.id,
		answer: {_tag: "refused", why: "changed_elsewhere", now: s.base + 2},
	});
	expect(box(k, d, s)._tag).toBe("stale");
	return letter;
};
const damaged = (next: Model, selected: string, patch: object): Model => ({
	...next,
	boxes: {...next.boxes, [selected]: {...next.boxes[selected], ...patch}},
});

describe("P20 editor laws", () => {
	law(
		"L04 opening reads; checked patches follow saved text without saving",
		(_p, m, n, c) => (m.type === "select" ? [damaged(n, m.note, {_tag: "editing"}), c] : [n, c]),
		(k) => {
			fc.assert(
				fc.property(k.sample, (s) => {
					const d = drive(k);
					open(k, d, s, false);
					expect(box(k, d, s)).toMatchObject({_tag: "reading", base: s.base});
					const cmds = d.send({
						type: "view",
						notes: k.saved(s).map((n) => ({...n, version: n.version + 1, body: s.later})),
					});
					expect(box(k, d, s)).toMatchObject({_tag: "reading", base: s.base + 1});
					expect(k.editor.view(d.state)).toEqual(expect.objectContaining({body: s.later}));
					expect(cmds).toEqual([]);
				}),
				k.options,
			);
		},
	);
	law(
		"L05 Edit copies that note's saved body and base",
		(_p, m, n, c) =>
			m.type === "edit" ? [damaged(n, n.selected, {draft: "", base: 0}), c] : [n, c],
		(k) => {
			const seq = k.sample.map((s) => [
				{type: "view", notes: k.saved(s)},
				{type: "select", note: k.first(s.ids)},
				{type: "edit"},
			]);
			propertyInvariant(
				k.editor.machine,
				{},
				seq,
				({prev, msg, next}: {prev: Model; msg: Event; next: Model}) => {
					if (msg.type !== "edit") return true;
					const expected = prev.notes.find((n: {note: string}) => n.note === prev.selected);
					expect(expected).toBeDefined();
					expect(next.boxes[next.selected]).toMatchObject({
						_tag: "editing",
						draft: expected.body,
						saved: expected.body,
						base: expected.version,
					});
					return true;
				},
				k.options,
			);
		},
	);
	law(
		"L06 newer views never replace a draft or its base",
		(_p, m, n, c) =>
			m.type === "view" && n.selected !== null && n.boxes[n.selected]?._tag === "editing"
				? [damaged(n, n.selected, {draft: "replaced"}), c]
				: [n, c],
		(k) => {
			const seq = k.sample.chain((s) =>
				fc.array(k.text, {minLength: 1, maxLength: 12}).map((bodies) => [
					{type: "view", notes: k.saved(s)},
					{type: "select", note: k.first(s.ids)},
					{type: "edit"},
					...bodies.flatMap((body) => [
						{type: "typed", body},
						{
							type: "view",
							notes: k.saved(s).map((n) => ({...n, version: n.version + 1, body: s.later})),
						},
					]),
				]),
			);
			propertyInvariant(
				k.editor.machine,
				{},
				seq,
				({prev, msg, next}: {prev: Model; msg: Event; next: Model}) => {
					if (
						msg.type !== "view" ||
						prev.selected === null ||
						prev.boxes[prev.selected]?._tag !== "editing"
					)
						return true;
					expect(next.boxes[prev.selected]).toEqual(prev.boxes[prev.selected]);
					return true;
				},
				k.options,
			);
		},
	);
	law(
		"L07 only one save per note while stamping or awaiting acceptance",
		(_p, m, n, c) => (m.type === "done" ? [n, [...c, {type: "duplicate_save"}]] : [n, c]),
		(k) => {
			fc.assert(
				fc.property(k.sample, fc.array(k.text, {minLength: 1, maxLength: 12}), (s, bodies) => {
					const d = drive(k);
					open(k, d, s);
					d.send({type: "typed", body: s.draft});
					d.send({type: "done"});
					for (const body of bodies) {
						d.send({type: "typed", body});
						expect(d.send({type: "done"})).toEqual([]);
						expect(d.send({type: "pause", note: k.first(s.ids), edit: box(k, d, s).edit})).toEqual(
							[],
						);
					}
					d.send({type: "stamped", note: k.first(s.ids), letter: k.frozen(s)});
					expect(d.send({type: "done"})).toEqual([]);
					expect(box(k, d, s)._tag).toBe("saving");
					const other = k.first(s.ids.slice(1));
					d.send({type: "select", note: other});
					d.send({type: "edit"});
					d.send({type: "typed", body: s.later});
					d.send({type: "done"});
					expect(d.state.boxes[other]).toMatchObject({
						_tag: "preparing",
						sent: {note: other, base: s.base + 1, body: s.later},
					});
					expect(d.state.boxes[k.first(s.ids)]._tag).toBe("saving");
					expect(d.send({type: "done"})).toEqual([]);
				}),
				k.options,
			);
		},
	);
	law(
		"L08 newer typing waits then saves on the accepted per-note base",
		(_p, m, n, c) =>
			m.type === "answer" && m.answer._tag === "accepted"
				? [damaged(n, m.note, {base: 0}), c]
				: [n, c],
		(k) => {
			fc.assert(
				fc.property(k.sample, (s) => {
					const d = drive(k),
						letter = begin(k, d, s);
					d.send({type: "typed", body: `${s.later}!`});
					const patch = () =>
						d.send({
							type: "view",
							notes: [{note: k.first(s.ids), version: s.base + 1, body: `${s.body}0${s.draft}`}],
						});
					if (s.patchFirst) patch();
					accept(k, d, s, letter);
					if (!s.patchFirst) patch();
					expect(box(k, d, s)).toMatchObject({draft: `${s.later}!`, base: s.base + 1});
					if (box(k, d, s)._tag === "editing")
						d.send({type: "pause", note: k.first(s.ids), edit: box(k, d, s).edit});
					expect(box(k, d, s)).toMatchObject({
						_tag: "preparing",
						sent: {base: s.base + 1, body: `${s.later}!`},
					});
				}),
				k.options,
			);
		},
	);
	law(
		"L09 Done saves then reads; unchanged existing and new blank notes write nothing",
		(_p, m, n, c) => (m.type === "done" ? [damaged(n, n.selected, {_tag: "reading"}), c] : [n, c]),
		(k) => {
			fc.assert(
				fc.property(k.sample, (s) => {
					const d = drive(k),
						letter = begin(k, d, s);
					expect(box(k, d, s)).toMatchObject({_tag: "saving", sent: {how: "done"}});
					accept(k, d, s, letter);
					expect(box(k, d, s)._tag).toBe("reading");
					const same = drive(k);
					open(k, same, s);
					expect(same.send({type: "done"})).toEqual([]);
					expect(box(k, same, s)._tag).toBe("reading");
				}),
				k.options,
			);
		},
	);
	law(
		"L11 current pause and leave save; old timers and composition never save",
		(_p, m, n, c) => (m.type === "pause" ? [n, [...c, {type: "outdated_timer_save"}]] : [n, c]),
		(k) => {
			fc.assert(
				fc.property(k.sample, fc.constantFrom("pause", "leave"), (s, action) => {
					const d = drive(k);
					open(k, d, s);
					d.send({type: "typed", body: s.draft});
					const old = box(k, d, s).edit;
					d.send({type: "typed", body: `${s.later}!`});
					expect(d.send({type: "pause", note: k.first(s.ids), edit: old})).toEqual([]);
					d.send({type: "composition", active: true});
					expect(d.send({type: "pause", note: k.first(s.ids), edit: box(k, d, s).edit})).toEqual(
						[],
					);
					d.send({type: "composition", active: false});
					d.send(
						action === "pause"
							? {type: "pause", note: k.first(s.ids), edit: box(k, d, s).edit}
							: {type: "leave"},
					);
					expect(box(k, d, s)).toMatchObject({
						_tag: "preparing",
						sent: {how: action, body: `${s.later}!`, base: s.base},
					});
				}),
				k.options,
			);
		},
	);
	law(
		"L15 refusals and no link retain exact drafts",
		(_p, m, n, c) =>
			m.type === "answer" && m.answer._tag === "refused"
				? [damaged(n, m.note, {draft: ""}), c]
				: [n, c],
		(k) => {
			fc.assert(
				fc.property(k.sample, fc.constantFrom("changed_elsewhere", "too_long"), (s, why) => {
					const d = drive(k),
						letter = begin(k, d, s);
					d.send({type: "typed", body: `${s.later}!`});
					d.send({type: "link", online: false});
					expect(box(k, d, s)).toMatchObject({draft: `${s.later}!`, letter});
					d.send({
						type: "answer",
						note: k.first(s.ids),
						letter: letter.id,
						answer: {_tag: "refused", why, now: s.base + 2, most: 256},
					});
					d.send({
						type: "view",
						notes: [{note: k.first(s.ids), version: s.base + 2, body: s.body}],
					});
					expect(box(k, d, s)).toMatchObject({
						_tag: why === "too_long" ? "too_long" : "stale",
						draft: `${s.later}!`,
						base: s.base,
					});
				}),
				k.options,
			);
		},
	);
	law(
		"L16 Keep allocates once, keeps original base, and retains draft until acceptance",
		(_p, m, n, c) => (m.type === "keep" ? [damaged(n, n.selected, {draft: ""}), c] : [n, c]),
		(k) => {
			fc.assert(
				fc.property(k.sample, (s) => {
					const d = drive(k);
					stale(k, d, s);
					const original = k.first(s.ids),
						fresh = k.first(s.ids.slice(1));
					const cmds = d.send({type: "keep"}),
						allocation = k.first(cmds);
					expect(d.state.allocating).toBe(true);
					expect(d.send({type: "keep"})).toEqual([]);
					expect(d.state.boxes[original].draft).toBe(`${s.body}0${s.draft}`);
					d.send({type: `${allocation.type}_ok`, cmd: allocation, value: fresh, at: 1});
					const pending = Object.values(d.state.boxes).find(
						(b: Model["boxes"][string]) => b.sent?.how === "kept",
					);
					expect(pending).toMatchObject({
						sent: {
							note: fresh,
							base: 0,
							body: `${s.body}0${s.draft}`,
							how: "kept",
							from: {note: original, version: s.base},
						},
					});
					expect(d.state.boxes[original].draft).toBe(`${s.body}0${s.draft}`);
					const kept = {
						...k.frozen(s, fresh, `${s.body}0${s.draft}`, 0),
						m: {
							type: "save",
							value: {
								note: fresh,
								base: 0,
								body: `${s.body}0${s.draft}`,
								how: "kept",
								from: {note: original, version: s.base},
							},
						},
					};
					d.send({type: "stamped", note: fresh, letter: kept});
					d.send({type: "link", online: false});
					expect(d.send({type: "keep"})).toEqual([]);
					expect(d.state.boxes[original].draft).toBe(`${s.body}0${s.draft}`);
					d.send({type: "link", online: true});
					d.send({
						type: "answer",
						note: fresh,
						letter: kept.id,
						answer: {_tag: "accepted", rev: s.seen + 1, pos: 1},
					});
					expect(d.state.boxes[fresh]).toMatchObject({_tag: "reading", base: 1});
					const failed = drive(k);
					stale(k, failed, s);
					const failedAllocation = k.first(failed.send({type: "keep"}));
					failed.send({
						type: `${failedAllocation.type}_err`,
						cmd: failedAllocation,
						error: {_tag: "entropy"},
						at: 0,
					});
					expect(failed.state.boxes[original].draft).toBe(`${s.body}0${s.draft}`);
					expect(failed.send({type: "keep"}).length).toBeGreaterThan(0);
				}),
				k.options,
			);
		},
	);
	law(
		"L17 Drop changes only its stale local draft and emits no save",
		(_p, m, n, c) => (m.type === "drop" ? [{...n, boxes: {}}, c] : [n, c]),
		(k) => {
			fc.assert(
				fc.property(k.sample, (s) => {
					const d = drive(k),
						other = k.first(s.ids.slice(1));
					open(k, d, s);
					d.send({type: "select", note: other});
					d.send({type: "edit"});
					d.send({type: "typed", body: s.later});
					stale(k, d, s);
					d.send({
						type: "view",
						notes: k.saved(s).map((n) => ({...n, body: s.body, version: n.version + 2})),
					});
					const retained = d.state.boxes[other];
					expect(d.send({type: "drop"})).toEqual([]);
					expect(box(k, d, s)).toMatchObject({_tag: "reading", base: s.base + 2});
					expect(d.state.boxes[other]).toBe(retained);
				}),
				k.options,
			);
		},
	);
	law(
		"L18 Saved requires this letter's acceptance with no newer typing",
		(_p, m, n, c) => (m.type === "stamped" ? [damaged(n, m.note, {_tag: "reading"}), c] : [n, c]),
		(k) => {
			fc.assert(
				fc.property(k.sample, fc.boolean(), (s, newer) => {
					const d = drive(k),
						letter = begin(k, d, s),
						other = k.first(s.ids.slice(1));
					expect(k.editor.view(d.state).status).not.toBe("Saved");
					const pending = box(k, d, s);
					d.send({
						type: "answer",
						note: other,
						letter: letter.id,
						answer: {_tag: "accepted", rev: 1, pos: 1},
					});
					d.send({
						type: "answer",
						note: k.first(s.ids),
						letter: `letter_${other.slice(5)}`,
						answer: {_tag: "accepted", rev: 1, pos: 1},
					});
					expect(box(k, d, s)).toEqual(pending);
					if (newer) d.send({type: "typed", body: `${s.later}!`});
					accept(k, d, s, letter);
					expect(k.editor.view(d.state).status === "Saved").toBe(!newer);
					const settled = d.state;
					accept(k, d, s, letter);
					expect(d.state).toEqual(settled);
				}),
				k.options,
			);
		},
	);
	law(
		"L24 failed reads retain drafts and Retry reads; old pages cannot replace current history",
		(_p, m, n, c) => (m.type === "retry" ? [n, []] : [n, c]),
		(k) => {
			fc.assert(
				fc.property(k.sample, (s) => {
					const d = drive(k);
					open(k, d, s);
					d.send({type: "typed", body: s.draft});
					d.send({type: "history"});
					const oldRequest = d.state.history.request;
					d.send({type: "read_failed"});
					expect(box(k, d, s).draft).toBe(s.draft);
					expect(d.state.readFailed).toBe(true);
					expect(d.send({type: "retry"}).length).toBeGreaterThan(0);
					d.send({type: "select", note: k.first(s.ids.slice(1))});
					d.send({type: "history"});
					const current = d.state.history;
					d.send({
						type: "history_page",
						note: k.first(s.ids),
						request: oldRequest,
						page: {entries: [], after: s.seen, more: false},
					});
					expect(d.state.history).toEqual(current);
					expect(d.state.boxes[k.first(s.ids)].draft).toBe(s.draft);
					const history = drive(k);
					open(k, history, s, false);
					history.send({type: "history"});
					history.send({
						type: "history_page",
						note: k.first(s.ids),
						request: history.state.history.request,
						page: {entries: [historyEntry(k, s)], after: s.seen, more: false},
					});
					const loaded = history.state.history.versions;
					expect(loaded.length).toBeGreaterThan(0);
					history.send({type: "read_failed"});
					expect(history.state.history.versions).toEqual(loaded);
					expect(history.send({type: "retry"}).length).toBeGreaterThan(0);
				}),
				k.options,
			);
		},
	);
	it("L26 S2/p88 every JSON cut keeps drafts, intents, stamp reservations and frozen letters", async () => {
		const k = await load();
		fc.assert(
			fc.property(k.sample, fc.array(k.text, {maxLength: 8}), (s, tail) => {
				const d = drive(k),
					letter = begin(k, d, s);
				for (const body of tail) d.send({type: "typed", body});
				d.send({type: "link", online: false});
				d.send({type: "link", online: true});
				accept(k, d, s, letter);
				const h = drive(k);
				open(k, h, s, false);
				h.send({type: "history"});
				expect(h.state.history._tag).toBe("loading");
				h.send({type: "read_failed"});
				h.send({type: "retry"});
				h.send({
					type: "history_page",
					note: k.first(s.ids),
					request: h.state.history.request,
					page: {entries: [historyEntry(k, s)], after: s.seen, more: false},
				});
				expect(h.state.history._tag).toBe("ready");
				h.send({type: "close_history"});
				const kept = drive(k);
				stale(k, kept, s);
				const allocation = k.first(kept.send({type: "keep"}));
				kept.send({
					type: `${allocation.type}_ok`,
					cmd: allocation,
					value: k.first(s.ids.slice(1)),
					at: 0,
				});
				const prove = (decode: (raw: unknown) => Model) => {
					for (const trace of [d, h, kept])
						syncTest(
							k.editor.machine,
							{},
							{
								msgs: trace.msgs,
								encode: Schema.encodeSync(k.editor.Model),
								decode,
								equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
								seed: k.options.seed,
							},
						);
				};
				prove(Schema.decodeUnknownSync(k.editor.Model));
				expect(() =>
					prove((raw) => ({...Schema.decodeUnknownSync(k.editor.Model)(raw), boxes: {}})),
				).toThrow();
			}),
			k.options,
		);
	});
	it("L02 outside and saved nested IDs decode as typed failures, including Keep allocation replies", async () => {
		const k = await load();
		fc.assert(
			fc.property(
				k.sample,
				fc.oneof(
					k.invalidId,
					fc.jsonValue().map((value) => ({value})),
				),
				(s, invalid) => {
					expect(
						Result.isFailure(
							Effect.runSync(Effect.result(Schema.decodeUnknownEffect(k.spec.note)(invalid))),
						),
					).toBe(true);
					const d = drive(k);
					stale(k, d, s);
					const cmd = k.first(d.send({type: "keep"}));
					expect(() => d.send({type: `${cmd.type}_ok`, cmd, value: invalid, at: 0})).not.toThrow();
					expect(d.state.boxes[k.first(s.ids)].draft).toBe(`${s.body}0${s.draft}`);
					expect(d.send({type: "keep"}).length).toBeGreaterThan(0);
					const waiting = drive(k);
					begin(k, waiting, s);
					const pending = box(k, waiting, s),
						id = k.first(s.ids);
					for (const raw of [
						{...d.state, selected: invalid},
						{...d.state, notes: [{note: invalid, version: s.base, body: s.body}]},
						{...d.state, boxes: {[k.first(s.ids)]: {...box(k, d, s), note: invalid}}},
						{...d.state, boxes: {[k.first(s.ids.slice(1))]: box(k, d, s)}},
						{
							...waiting.state,
							boxes: {[id]: {...pending, letter: {...pending.letter, id: invalid}}},
						},
						{
							...waiting.state,
							boxes: {[id]: {...pending, letter: {...pending.letter, pid: invalid}}},
						},
						{...waiting.state, boxes: {[id]: {...pending, sent: {...pending.sent, note: invalid}}}},
						{
							...waiting.state,
							boxes: {
								[id]: {...pending, sent: {...pending.sent, from: {note: invalid, version: s.base}}},
							},
						},
						// oxlint-disable-next-line unicorn/no-thenable -- This is the plan's data field for the next action, not a function.
						{...waiting.state, boxes: {[id]: {...pending, then: {_tag: "open", note: invalid}}}},
						{...waiting.state, history: {_tag: "loading", note: invalid, after: 0, request: 1}},
					])
						expect(
							Result.isFailure(
								Effect.runSync(Effect.result(Schema.decodeUnknownEffect(k.editor.Model)(raw))),
							),
						).toBe(true);
				},
			),
			k.options,
		);
	});
	it("L03 outside events and unchecked editor declarations fail without throwing", async () => {
		const k = await load();
		fc.assert(
			fc.property(fc.jsonValue(), k.sample, (raw, s) => {
				const valid = {type: "typed", body: s.draft};
				expect(Effect.runSync(Schema.decodeUnknownEffect(k.editor.Event)(valid))).toEqual(valid);
				const invalid = {type: "typed", body: raw === null ? 0 : {raw}};
				expect(
					Result.isFailure(
						Effect.runSync(Effect.result(Schema.decodeUnknownEffect(k.editor.Event)(invalid))),
					),
				).toBe(true);
				expect(Result.isFailure(Effect.runSync(Effect.result(k.NoteEditor.makeEffect(raw))))).toBe(
					true,
				);
			}),
			k.options,
		);
	});
});

const Send = Schema.TaggedStruct("send", {m: Schema.Json});
const historyEntry = (k: Kit, s: Sample) =>
	Entry.make({
		id: `input_${k.first(s.ids).slice(5)}`,
		stream: "notes:1/inbox",
		pos: s.base,
		rev: s.seen,
		arrivedAt: 1000,
		...lineFor(
			{
				by: "writer-test",
				for: "person-test",
				sentAt: "2026-11-08T00:00:00Z",
				seen: 0,
				parent: null,
				traceId: "10000000000000000000000000000001",
				build: "test",
			},
			Send.make({m: {type: "save", value: {note: k.first(s.ids), base: s.base - 1, body: s.body}}}),
		),
	});
