import {defineMachine} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";
import {
	bindingFor,
	defaults,
	Does,
	fileWord,
	Key,
	Keys,
	sameTarget,
	spell,
	Target as CommandTarget,
} from "../desk/keymap.ts";
import {keyName, matchPress, type Press, THE_MACS, wordOf} from "../desk/keys.ts";
import {Edit} from "./schema.ts";

const Target = Schema.TaggedUnion({
	command: {does: Schema.optionalKey(Does), target: Schema.optionalKey(CommandTarget)},
	prefix: {},
	ignore: {},
});
type Target = typeof Target.Type;
const Recording = Schema.TaggedUnion({
	idle: {},
	waiting: {target: Target, prefix: Schema.Boolean, add: Schema.Boolean},
	candidate: {target: Target, keys: Schema.Array(Key), add: Schema.Boolean},
	saving: {request: Schema.String, undo: Schema.Boolean},
});

export interface Editor {
	readonly keys: Keys;
	readonly query: string;
	readonly selected: Does | CommandTarget | null;
	readonly mapping: boolean;
	readonly catalog: number;
	readonly recording: typeof Recording.Type;
	readonly next: number;
	readonly error: string | null;
	readonly undo: string | null;
	/**
	 * How this editor's last save ended, until the next one does: after a failed save, an older
	 * "Keys saved." never stands beside its words.
	 */
	readonly save: "done" | "failed" | null;
}
export const EditorState = Schema.Struct({
	keys: Keys,
	query: Schema.String,
	selected: Schema.NullOr(Schema.Union([Does, CommandTarget])),
	recording: Recording,
	next: Schema.Int,
	error: Schema.NullOr(Schema.String),
	undo: Schema.NullOr(Schema.String),
	save: Schema.NullOr(Schema.Literals(["done", "failed"])),
	mapping: Schema.Boolean,
	catalog: Schema.Int,
});
export const EditorCommand = Schema.Union(
	(["mapping", "change", "add", "save", "unbind", "reset", "cancel"] as const).map((type) =>
		Schema.Struct({type: Schema.Literal(type)}),
	),
);

const edit = Cmd.make("edit", {
	input: Schema.Struct({edit: Edit, request: Schema.String}),
	ok: Schema.Null,
	err: [],
});
export type EditorCmd = ReturnType<typeof edit>;
export type EditorMsg =
	| {readonly type: "query"; readonly query: string}
	| {readonly type: "select"; readonly does?: Does | null; readonly target?: CommandTarget}
	| {
			readonly type:
				| "change"
				| "add"
				| "cancel"
				| "save"
				| "unbind"
				| "reset"
				| "escape-key"
				| "mapping";
	  }
	| {readonly type: "press"; readonly press: Press}
	| {
			readonly type: "keys";
			readonly keys: Keys;
			readonly version?: string;
			readonly catalog?: number;
	  }
	| {readonly type: "saved"; readonly request: string; readonly version: string}
	| {readonly type: "failed"; readonly request: string; readonly why: string}
	| {readonly type: "undo"};

const spelling = (key: Key) => `${key._tag === "after_prefix" ? "<prefix>" : ""}${spell(key.key)}`;
export const matching = (keys: Keys, query: string) => {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return keys.rows.filter((row) => {
		const binding = bindingFor(row.does);
		const text =
			`${fileWord(row.target)} ${row.scope} ${row.disabled ?? ""} ${binding?.name ?? row.target.word} ${binding === undefined ? row.does : wordOf(binding.does)} ${row.keys.map((key) => `${spelling(key)} ${key._tag === "after_prefix" ? `${spell(keys.prefix)} ${spell(key.key)}` : spell(key.key)}`).join(" ")}`.toLowerCase();
		return words.every((word) => text.includes(word));
	});
};

type Step = readonly [Editor, readonly EditorCmd[]];
const idle = () => Recording.cases.idle.make({});
const target = (selected: Editor["selected"]): Target | null =>
	selected === null
		? null
		: selected === "prefix"
			? Target.cases.prefix.make({})
			: selected === "ignore"
				? Target.cases.ignore.make({})
				: Target.cases.command.make(
						typeof selected === "string" ? {does: selected} : {target: selected},
					);
const saving = (s: Editor, request: typeof Edit.Type): Step => {
	const id = `keys-${s.next}`;
	return [
		{
			...s,
			next: s.next + 1,
			error: null,
			recording: Recording.cases.saving.make({request: id, undo: request._tag === "undo"}),
		},
		[edit({request: id, edit: request})],
	];
};
const recording = (s: Editor, add: boolean): Step => {
	const selected = target(s.selected);
	return selected === null
		? [s, []]
		: [
				{
					...s,
					error: null,
					recording: Recording.cases.waiting.make({target: selected, prefix: false, add}),
				},
				[],
			];
};
const update = (s: Editor, m: EditorMsg): Step => {
	switch (m.type) {
		case "query":
			return [{...s, query: m.query}, []];
		case "select":
			return [{...s, selected: m.target ?? m.does ?? null, recording: idle(), error: null}, []];
		case "mapping":
			return [{...s, mapping: !s.mapping, recording: idle(), error: null}, []];
		case "change":
			return recording(s, false);
		case "add":
			return recording(s, true);
		case "cancel":
			return [{...s, recording: idle(), error: null}, []];
		case "escape-key":
			return s.recording._tag !== "waiting"
				? [s, []]
				: [
						{
							...s,
							recording: Recording.cases.candidate.make({
								target: s.recording.target,
								add: s.recording.add,
								keys: [
									s.recording.prefix
										? Key.cases.after_prefix.make({key: "<escape>"})
										: Key.cases.alone.make({key: "<escape>"}),
								],
							}),
						},
						[],
					];
		case "press": {
			const r = s.recording;
			if (r._tag !== "waiting") return [s, []];
			const name = keyName(m.press);
			if (name === null || THE_MACS.has(name) || name === "<c-c>") return [s, []];
			if (name === "<escape>") return update(s, {type: "cancel"});
			if (
				r.target._tag === "command" &&
				!r.prefix &&
				matchPress(m.press, [Key.cases.alone.make({key: s.keys.prefix})], true) !== null
			)
				return [{...s, recording: {...r, prefix: true}}, []];
			const typed =
				(m.press.alt || m.press.altGraph) && [...m.press.key].length === 1
					? (keyName({...m.press, alt: false, ctrl: m.press.altGraph ? false : m.press.ctrl}) ??
						name)
					: name;
			const key = r.prefix
				? Key.cases.after_prefix.make({key: typed})
				: Key.cases.alone.make({key: typed});
			return [
				{
					...s,
					recording: Recording.cases.candidate.make({target: r.target, keys: [key], add: r.add}),
				},
				[],
			];
		}
		case "save": {
			const r = s.recording;
			if (r._tag !== "candidate") return [s, []];
			if (r.target._tag === "prefix")
				return saving(s, Edit.cases.prefix.make({key: spell(r.keys[0]?.key ?? "")}));
			const selected = r.target;
			const original = r.add
				? selected._tag === "ignore"
					? s.keys.ignore.map(spell)
					: (s.keys.rows
							.find((row) =>
								selected.target === undefined
									? row.does === selected.does
									: sameTarget(row.target, selected.target),
							)
							?.keys.map(spelling) ?? [])
				: [];
			const keys = [...new Set([...original, ...r.keys.map(spelling)])];
			return saving(
				s,
				selected._tag === "ignore"
					? Edit.cases.ignore.make({keys})
					: Edit.cases.bind.make({
							...(selected.target === undefined
								? selected.does === undefined
									? {}
									: {does: selected.does}
								: {target: selected.target}),
							keys,
						}),
			);
		}
		case "unbind":
		case "reset":
			if (s.selected === "prefix" || s.selected === "ignore")
				return saving(
					s,
					m.type === "reset"
						? Edit.cases.reset.make({does: s.selected})
						: s.selected === "ignore"
							? Edit.cases.ignore.make({keys: []})
							: Edit.cases.prefix.make({key: spell(s.keys.prefix)}),
				);
			if (s.selected === null) return [s, []];
			return saving(
				s,
				m.type === "reset"
					? Edit.cases.reset.make(
							typeof s.selected === "string" ? {does: s.selected} : {target: s.selected},
						)
					: Edit.cases.bind.make({
							...(typeof s.selected === "string" ? {does: s.selected} : {target: s.selected}),
							keys: [],
						}),
			);
		case "keys": {
			const gone =
				typeof s.selected === "object" &&
				s.selected !== null &&
				!m.keys.rows.some((row) => sameTarget(row.target, s.selected as CommandTarget));
			const catalog = m.catalog ?? s.catalog;
			const moved = s.undo !== null && m.version !== undefined && m.version !== s.undo;
			// While our own save runs, its broadcast can land before its answer: that new version is
			// ours, so the old Undo just goes quietly and `saved` offers the new one.
			const ours = s.recording._tag === "saving";
			return [
				{
					...s,
					keys: m.keys,
					catalog,
					selected: gone ? null : s.selected,
					recording: gone ? idle() : s.recording,
					mapping: gone ? false : s.mapping,
					undo: moved || catalog !== s.catalog ? null : s.undo,
					error: moved && !ours ? "The file changed. Undo is no longer available." : s.error,
				},
				[],
			];
		}
		case "saved":
			return s.recording._tag !== "saving" || s.recording.request !== m.request
				? [s, []]
				: [
						{
							...s,
							recording: idle(),
							undo: s.recording.undo ? null : m.version,
							error: null,
							save: "done",
						},
						[],
					];
		case "failed":
			if (m.request === "open") return [{...s, error: m.why}, []];
			return s.recording._tag !== "saving" || s.recording.request !== m.request
				? [s, []]
				: [{...s, recording: idle(), error: `Save failed: ${m.why}`, save: "failed"}, []];
		case "undo":
			return s.undo === null ? [s, []] : saving(s, Edit.cases.undo.make({version: s.undo}));
	}
};
const init = (loaded: Keys | Editor | null, _ctx: undefined): Step => [
	{
		keys: loaded !== null && "query" in loaded ? loaded.keys : (loaded ?? defaults),
		query: "",
		selected: null,
		mapping: false,
		catalog: 0,
		recording: idle(),
		next: 0,
		error: null,
		undo: null,
		save: null,
	},
	[],
];
const machine = defineMachine({
	types: {model: {} as Editor, msg: {} as EditorMsg, cmd: {} as EditorCmd, ctx: undefined},
	init,
	update: {
		query: update,
		select: update,
		change: update,
		add: update,
		cancel: update,
		save: update,
		unbind: update,
		reset: update,
		"escape-key": update,
		press: update,
		keys: update,
		saved: update,
		failed: update,
		undo: update,
		mapping: update,
	},
});
export const editorMachine = {...machine, init};
