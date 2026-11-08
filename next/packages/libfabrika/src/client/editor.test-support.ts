// T293, next/. Inputs and a pure tea driver only. No editor or delivery decisions live here.
import {applyCell, type Cmd, type Machine, type Reducer, type Sub} from "@demlik/tea";
import {type Brand, Effect, Ref, Schema} from "effect";
import * as fc from "fast-check";
import {Id} from "../data/id.ts";
import {Entry, lineFor} from "../data/log.ts";
import type {Delivery, LetterId} from "./protocol.ts";
import {Letter, Via} from "./window.ts";

export const options = {seed: 119120, numRuns: 80};
const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
// 128 bits, UUID version 7, RFC variant 10. Two leading padding bits stay zero.
export const suffix = fc.uint8Array({minLength: 16, maxLength: 16}).map((bytes) => {
	const copy = Array.from(bytes);
	copy[6] = ((copy[6] ?? 0) & 15) | 112;
	copy[8] = ((copy[8] ?? 0) & 63) | 128;
	let n = copy.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
	let text = "";
	for (let i = 0; i < 26; i++) {
		text = `${alphabet[Number(n & 31n)]}${text}`;
		n >>= 5n;
	}
	return text;
});
export const Note: Schema.Codec<Brand.Branded<string, "note">, string> & {readonly prefix: "note"} =
	Id.make("note");
export type Note = typeof Note.Type;
export const noteId = suffix.map((s) => Schema.decodeUnknownSync(Note)(`note_${s}`));
export const text = fc.oneof(
	fc.string(),
	fc.constantFrom("", "\n \t", "مرحبا🙂\r\n  ", "<script>text</script>"),
);
export const version = fc.integer({min: 1, max: 10000});
export const sample = fc
	.record({
		ids: fc.uniqueArray(noteId, {minLength: 3, maxLength: 5}),
		body: text,
		base: version,
		draft: text.map((s) => `${s}\nchanged`),
		later: text.map((s) => `${s}\nlater`),
		patchFirst: fc.boolean(),
		seen: fc.integer({min: 0, max: 100000}),
	})
	.map((s) => ({...s, seen: s.seen + s.base * s.ids.length + s.ids.length * s.ids.length}));
export type Sample = typeof sample extends fc.Arbitrary<infer A> ? A : never;
export const invalidId = suffix.chain((s) =>
	fc.constantFrom(
		`other_${s}`,
		`note_${s.slice(1)}`,
		`note_8${s.slice(1)}`,
		`note_${s.slice(0, 10)}0${s.slice(11)}`,
		`note_${s.slice(0, 13)}0${s.slice(14)}`,
		`note_${s.slice(0, 25)}i`,
		null,
		7,
		{},
		[],
	),
);
const Save = Schema.Struct({
	note: Note,
	base: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	body: Schema.String,
	how: Schema.optionalKey(Schema.Literals(["pause", "leave", "done", "kept"])),
	from: Schema.optionalKey(
		Schema.Struct({note: Note, version: Schema.Int.check(Schema.isGreaterThan(0))}),
	),
});
export const spec = {
	note: Note,
	save: Save,
	view: Schema.Struct({
		notes: Schema.Array(Schema.Struct({note: Note, version: Schema.Int, body: Schema.String})),
	}),
};

export interface EditorWire {
	readonly sent: Effect.Effect<ReadonlyArray<typeof Letter.Type>>;
	readonly answer: (id: typeof LetterId.Type, answer: typeof Delivery.Type) => Effect.Effect<void>;
	readonly online: (value: boolean) => Effect.Effect<void>;
}
// A controlled recorder, never a queue or retry policy. The parent owns all retries.
export const wire = Effect.fn("test.editorWire")(function* () {
	const sent = yield* Ref.make<ReadonlyArray<typeof Letter.Type>>([]);
	const answers = yield* Ref.make<
		ReadonlyArray<{id: typeof LetterId.Type; answer: typeof Delivery.Type}>
	>([]);
	const linked = yield* Ref.make(true);
	return {
		sent: Ref.get(sent),
		answers: Ref.get(answers),
		linked: Ref.get(linked),
		write: (letter: typeof Letter.Type) => Ref.update(sent, (all) => [...all, letter]),
		answer: (id: typeof LetterId.Type, answer: typeof Delivery.Type) =>
			Ref.update(answers, (all) => [...all, {id, answer}]),
		online: (value: boolean) => Ref.set(linked, value),
	};
});

export const saved = (s: Sample) =>
	s.ids.map((note, i) => ({note, version: s.base + i, body: `${s.body}${i}`}));
export const first = <A>(xs: ReadonlyArray<A>): A => {
	const value = xs[0];
	if (value === undefined) throw new Error("The generator must supply a value");
	return value;
};
export const frozen = (s: Sample, note = first(s.ids), body = s.draft, base = s.base) =>
	Schema.decodeUnknownSync(Letter)({
		id: `letter_${note.slice(5)}`,
		pid: `process_${note.slice(5)}`,
		m: {type: "save", value: {note, base, body, how: "done"}},
		seen: s.seen,
		sentAt: "2026-11-08T08:09:10.123Z",
		action: {does: "notes.done", via: Via.cases.click.make({})},
	});
const Send = Schema.TaggedStruct("send", {m: Schema.Json});
export const historyEntry = (s: Sample) =>
	Entry.make({
		id: `input_${first(s.ids).slice(5)}`,
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
			Send.make({m: {type: "save", value: {note: first(s.ids), base: s.base - 1, body: s.body}}}),
		),
	});

export class Driver<S, M extends {readonly type: string}, C extends Cmd, U extends Sub, X> {
	state: S;
	readonly cmds: C[] = [];
	readonly msgs: M[] = [];
	constructor(
		readonly machine: Machine<S, M, C, U, X>,
		readonly ctx: X,
	) {
		const [state, cmds] = machine.init(null, ctx);
		this.state = state;
		this.cmds.push(...cmds);
	}
	send(msg: M): ReadonlyArray<C> {
		const [state, cmds] = applyCell<S, M, C>(this.machine, this.state, msg);
		this.state = state;
		this.msgs.push(msg);
		this.cmds.push(...cmds);
		return cmds;
	}
}

// Change one real transition after the real reducer ran. Imports and boot failures occur before
// plant assertions, so missing code can never count as a killed plant.
export const planted = <S, M extends {readonly type: string}, C extends Cmd, U extends Sub, X>(
	machine: Machine<S, M, C, U, X>,
	change: (prev: S, msg: M, next: S, cmds: ReadonlyArray<C>) => readonly [S, ReadonlyArray<C>],
): Machine<S, M, C, U, X> => ({
	...machine,
	__form: "reducer",
	update: Object.fromEntries(
		Object.keys(machine.update).map((key) => [
			key,
			(s: S, m: M) => {
				const [next, cmds] = applyCell<S, M, C>(machine, s, m);
				return change(s, m, next, cmds);
			},
		]),
	) as Reducer<S, M, C>,
});
