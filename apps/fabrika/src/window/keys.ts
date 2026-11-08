import {defineMachine} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";
import {
	bindingFor,
	commandWord,
	effectiveKeys,
	Key,
	type Keys,
	type Row,
	sameTarget,
	spell,
	Target,
} from "../desk/keymap.ts";
import {keyName, keyOwner, matchPress, type Press, REPEAT_MS} from "../desk/keys.ts";

export const KeyPress = Schema.Struct({
	key: Schema.String,
	code: Schema.optionalKey(Schema.String),
	ctrl: Schema.Boolean,
	alt: Schema.Boolean,
	meta: Schema.Boolean,
	shift: Schema.optionalKey(Schema.Boolean),
	composing: Schema.optionalKey(Schema.Boolean),
	altGraph: Schema.optionalKey(Schema.Boolean),
});
export const Place = Schema.Struct({program: Schema.String, tile: Schema.String});
export type Place = typeof Place.Type;
export const CommandTarget = Schema.Struct({...Target.fields, tile: Schema.String});
export const Via = Schema.TaggedUnion({
	key: {keys: Schema.String},
	palette: {},
	tsh: {},
	button: {},
});
const run = Cmd.make("run", {
	input: Schema.Struct({
		id: Schema.String,
		target: CommandTarget,
		via: Schema.Union([Schema.Literals(["palette", "tsh", "button"]), Via]),
	}),
	ok: Schema.Null,
	err: [],
});
const pass = Cmd.make("pass", {
	input: Schema.Struct({target: Place, press: KeyPress, held: Schema.Boolean}),
	ok: Schema.Null,
	err: [],
});
const record = Cmd.make("record", {
	input: Schema.Struct({press: KeyPress}),
	ok: Schema.Null,
	err: [],
});
const system = Cmd.make("system", {
	input: Schema.Struct({press: KeyPress}),
	ok: Schema.Null,
	err: [],
});
const refuse = Cmd.make("refuse", {
	input: Schema.Struct({why: Schema.String}),
	ok: Schema.Null,
	err: [],
});
export type KeysCmd = ReturnType<
	typeof run | typeof pass | typeof record | typeof system | typeof refuse
>;
type Prefix = {readonly armed: false} | {readonly armed: true; readonly until: number | null};
type Stroke = {readonly press: Press; readonly at: number; readonly editing?: boolean};
export interface KeysModel {
	readonly keys: Keys;
	readonly window: string;
	readonly mac: boolean;
	readonly target: Place;
	readonly palette: Place | null;
	readonly prefix: Prefix;
	readonly modes: Readonly<Record<string, string | null>>;
	readonly mapping: boolean;
	readonly recording: boolean;
	readonly over: string | null;
	readonly question: string | null;
	readonly pending: string | null;
	readonly held: readonly Stroke[];
	readonly next: number;
	readonly up: boolean;
}
export type KeysMsg =
	| ({readonly type: "press"} & Stroke)
	| {readonly type: "keys"; readonly keys: Keys}
	| {readonly type: "target"; readonly target: Place}
	| {readonly type: "mode"; readonly program: string; readonly mode: string | null}
	| {readonly type: "mapping"; readonly active: boolean}
	| {readonly type: "recording"; readonly active: boolean}
	| {readonly type: "over"; readonly program: string | null}
	| {readonly type: "question"; readonly tile: string | null}
	| {readonly type: "palette"}
	| {
			readonly type: "command";
			readonly target: Target;
			readonly via: "palette" | "tsh" | "button";
			readonly window?: string;
	  }
	| {readonly type: "applied"; readonly id: string; readonly target: Place}
	| {readonly type: "down" | "up"};
type Context = {
	readonly keys: Keys;
	readonly window: string;
	readonly target: Place;
	readonly mac: boolean;
};
type Step = readonly [KeysModel, readonly KeysCmd[]];
const DISARMED: Prefix = {armed: false};
const modeOf = (s: KeysModel, program: string) => s.modes[program] ?? null;
export const available = (row: Row, target: Place, modes: KeysModel["modes"]): boolean =>
	(row.scope === "global" || row.target.program === target.program) &&
	(row.target.mode === (modes[row.target.program] ?? null) ||
		(row.scope === "global" && row.target.mode === null));

const issued = (
	s: KeysModel,
	target: typeof CommandTarget.Type,
	via: "palette" | "tsh" | "button" | typeof Via.Type,
): Step => {
	const id = `${s.window}:${s.next}`;
	// Only desk actions can change the input destination. Local actions finish in this window.
	const wait =
		target.program === "tezgah" &&
		![
			"info",
			"exit",
			"bars",
			"asks",
			"jobs",
			"agents",
			"sync",
			"host",
			"focus --to next",
			"focus --to previous",
		].includes(target.word);
	return [{...s, next: s.next + 1, pending: wait ? id : s.pending}, [run({id, target, via})]];
};
const fromRow = (s: KeysModel, row: Row, at: number, key: Key): Step => {
	const repeats = bindingFor(row.does)?.repeats === true;
	return issued(
		{...s, prefix: repeats ? {armed: true, until: at + REPEAT_MS} : DISARMED},
		{...row.target, tile: s.target.tile},
		Via.cases.key.make({
			keys: `${key._tag === "after_prefix" ? `${spell(s.keys.prefix)} ` : ""}${spell(key.key)}`,
		}),
	);
};
const matchingRow = (s: KeysModel, stroke: Stroke, after: boolean): {row: Row; key: Key} | null => {
	const candidates = s.keys.rows.filter((row) => available(row, s.target, s.modes));
	const priority = (row: Row): number =>
		row.target.program === s.over
			? 0
			: row.scope === "global" && row.target.mode !== null
				? 1
				: row.scope === "focused"
					? 2
					: 3;
	for (const row of candidates.toSorted((a, b) => priority(a) - priority(b))) {
		if (
			stroke.editing &&
			row.scope !== "global" &&
			row.target.program !== s.over &&
			!stroke.press.ctrl &&
			!stroke.press.meta &&
			row.target.word !== "return"
		)
			continue;
		const key = matchPress(
			stroke.press,
			effectiveKeys(row, s.keys.client).filter((k) => (k._tag === "after_prefix") === after),
			s.mac,
		);
		if (key !== null) return {row, key};
	}
	return null;
};
const pressed = (s: KeysModel, stroke: Stroke, held = false): Step => {
	const {press: p, at} = stroke;
	const name = keyName(p);
	if (name === null || p.altGraph) return [s, []];
	const owner = keyOwner(p, s.mac, s.keys);
	if (owner === "system") return [s, [system({press: p})]];
	if (owner === "nobody") return [s, []];
	if (name === "<c-c>") return [s, [pass({target: s.target, press: p, held})]];
	if (!s.up) return [s, []];
	if (s.recording) return [s, [record({press: p})]];
	if (s.pending !== null) return [{...s, held: [...s.held, stroke]}, []];
	if (s.question !== null)
		return issued(
			{...s, question: null, prefix: DISARMED},
			{program: "tezgah", word: name === "y" ? "confirm" : "cancel", mode: null, tile: s.question},
			Via.cases.key.make({keys: spell(name)}),
		);
	const isPrefix = matchPress(p, [Key.cases.alone.make({key: s.keys.prefix})], s.mac) !== null;
	const cycle = matchingRow(s, stroke, false);
	if (cycle?.row.does.startsWith('tezgah."focus --to ') && (name === "<f6>" || name === "<s-f6>"))
		return fromRow(s, cycle.row, at, cycle.key);
	if (s.prefix.armed) {
		const bound = matchingRow(s, stroke, true);
		if (
			s.prefix.until !== null &&
			(at > s.prefix.until || bound === null || !bindingFor(bound.row.does)?.repeats)
		)
			return pressed({...s, prefix: DISARMED}, stroke, held);
		if (isPrefix) {
			const sends = s.target.program === "tsh" && /^<c-([a-z]| )>$/.test(s.keys.prefix);
			return [{...s, prefix: DISARMED}, sends ? [pass({target: s.target, press: p, held})] : []];
		}
		return bound === null ? [{...s, prefix: DISARMED}, []] : fromRow(s, bound.row, at, bound.key);
	}
	if (isPrefix) return [{...s, prefix: {armed: true, until: null}}, []];
	if (cycle !== null) return fromRow(s, cycle.row, at, cycle.key);
	return [s, [pass({target: s.target, press: p, held})]];
};
const applied = (s: KeysModel, m: Extract<KeysMsg, {type: "applied"}>): Step => {
	if (s.pending !== m.id || !s.up) return [s, []];
	let next = {...s, target: m.target, pending: null, held: []} as KeysModel;
	const out: KeysCmd[] = [];
	for (const stroke of s.held) {
		const [moved, cmds] = pressed(next, stroke, true);
		next = moved;
		out.push(...cmds);
	}
	return [next, out];
};
export const keysMachine = defineMachine({
	types: {model: {} as KeysModel, msg: {} as KeysMsg, ctx: {} as Context},
	cmds: [run, pass, record, system, refuse],
	init: (_loaded, ctx) => [
		{
			...ctx,
			palette: null,
			prefix: DISARMED,
			modes: {},
			mapping: false,
			recording: false,
			over: null,
			question: null,
			pending: null,
			held: [],
			next: 0,
			up: true,
		},
		[],
	],
	update: {
		press: (s, m) => pressed(s, m),
		keys: (s, m) => [{...s, keys: m.keys, prefix: DISARMED}, []],
		target: (s, m) => [{...s, target: m.target}, []],
		mode: (s, m) => [{...s, modes: {...s.modes, [m.program]: m.mode}}, []],
		mapping: (s, m) => [{...s, mapping: m.active}, []],
		recording: (s, m) => [{...s, recording: m.active}, []],
		over: (s, m) => [{...s, over: m.program}, []],
		question: (s, m) => [{...s, question: m.tile}, []],
		palette: (s) => [{...s, palette: s.target}, []],
		command: (s, m) => {
			const target = m.via === "palette" ? (s.palette ?? s.target) : s.target;
			const row = s.keys.rows.find((row) => sameTarget(row.target, m.target));
			if (
				row === undefined ||
				!available(row, target, s.modes) ||
				(m.window !== undefined && m.window !== s.window)
			)
				return [
					s,
					[
						refuse({
							why: `${commandWord(m.target)} is unavailable in this window or mode ${modeOf(s, m.target.program) ?? "none"}.`,
						}),
					],
				];
			return issued({...s, prefix: DISARMED}, {...row.target, tile: target.tile}, m.via);
		},
		applied,
		down: (s) => [{...s, up: false, pending: null, held: [], prefix: DISARMED}, []],
		up: (s) => [{...s, up: true}, []],
		run_ok: (s) => [s, []],
		run_err: (s) => [s, []],
		pass_ok: (s) => [s, []],
		pass_err: (s) => [s, []],
		record_ok: (s) => [s, []],
		record_err: (s) => [s, []],
		system_ok: (s) => [s, []],
		system_err: (s) => [s, []],
		refuse_ok: (s) => [s, []],
		refuse_err: (s) => [s, []],
	},
});
