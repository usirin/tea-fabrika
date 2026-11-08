import {defineMachine} from "@demlik/tea";
import {Cmd, runIn} from "@demlik/tea/effect";
import {useMachine} from "@demlik/tea/react";
import {
	Asked,
	Answer,
	ASK_COMMANDS,
	type AskCommand,
	type Shows,
} from "@kampus/pipeline/tickets/ask";
import {Button, Collapsible, Kbd, Textarea} from "@manti-ui/react";
import {Effect, Layer, ManagedRuntime, Schema} from "effect";
import {createContext, useContext, useEffect, useRef, type KeyboardEvent} from "react";
import {AskAnswer} from "./ticket.ts";

const Editor = Schema.TaggedUnion({
	reading: {},
	picks: {},
	note: {pick: Schema.String, text: Schema.String},
	saving: {answer: Answer},
});
type Editor = typeof Editor.Type;
type Model = {
	ticket: number;
	ask: Asked;
	editor: Editor;
	needed?: boolean;
	took: {ms: number; opened: readonly string[]};
	failure: string | null;
	clock?: {focused: boolean; active: boolean; visible: boolean; at: number};
	draft?: Editor;
	key?: string;
	status?: string;
	evidence?: boolean;
};
type Msg =
	| {type: "do"; value: AskCommand; key?: string; now?: number}
	| {type: "pick"; pick: string; key?: string; now?: number}
	| {type: "note"; text: string}
	| {type: "submit"; key: string; now: number}
	| {type: "mark"; needed: boolean}
	| {type: "focus" | "active" | "visible"; value: boolean; now: number}
	| {type: "open"; name: string; now: number}
	| {type: "show"; ask: unknown; now: number}
	| {type: "tick"; now: number}
	| {type: "escape"}
	| {type: "save_ok"; value: unknown}
	| {type: "save_err"; error: {why: string}};
const save = Cmd.make("save", {input: AskAnswer, ok: Schema.Unknown, err: ["refused"]});
const answered = Cmd.make("answered", {
	input: Schema.Struct({ticket: Schema.Int}),
	ok: Schema.Unknown,
	err: [],
});
const later = Cmd.make("later", {
	input: Schema.Struct({key: Schema.String}),
	ok: Schema.Unknown,
	err: [],
});
type Command = ReturnType<typeof save> | ReturnType<typeof answered> | ReturnType<typeof later>;
type Step = [Model, readonly Command[]];
const reading = () => Editor.cases.reading.make({});
const timed = (model: Model, now: number): Model & {clock: NonNullable<Model["clock"]>} => {
	const clock = model.clock ?? {focused: false, active: true, visible: true, at: now};
	const ms = clock.focused && clock.active && clock.visible ? Math.max(0, now - clock.at) : 0;
	return {...model, took: {...model.took, ms: model.took.ms + ms}, clock: {...clock, at: now}};
};
const write = (model: Model, answer: Answer, key: string, now: number): Step => {
	if (model.editor._tag === "saving") return [model, []];
	const current = timed(model, now);
	const rec = current.ask.shows.rec;
	const value = AskAnswer.make({
		ticket: current.ticket,
		ask: current.ask.ask,
		answer,
		saw: current.ask.saw,
		via: {
			_tag: "window",
			took: {
				key,
				rec: rec._tag === "pick" ? "shown" : rec._tag === "hidden" ? "hidden" : "none",
				ms: current.took.ms,
				opened: current.took.opened,
				said: now,
			},
		},
		...(current.needed === undefined ? {} : {needed: current.needed}),
	});
	return [
		{...current, draft: current.editor, editor: Editor.cases.saving.make({answer}), failure: null},
		[save(value)],
	];
};
const pick = (model: Model, chosen: string, key: string, now: number): Step => {
	if (model.editor._tag === "saving" || !model.ask.shows.picks.some((p) => p.pick === chosen))
		return [model, []];
	const rec = model.ask.shows.rec;
	if (rec._tag !== "pick") return write(model, Answer.cases.chose.make({pick: chosen}), key, now);
	if (rec.pick === chosen) return write(model, Answer.cases.rec.make({}), key, now);
	return [{...model, editor: Editor.cases.note.make({pick: chosen, text: ""}), failure: null}, []];
};
/** Why a save was refused, in words. */
const whyOf = (error: unknown): string =>
	typeof error === "object" && error !== null && "why" in error && typeof error.why === "string"
		? error.why
		: "The answer could not be saved";

/** The save was refused: the draft and the ask stay, and the editor says why. */
const failed = (model: Model, error: unknown): Step => [
	{...model, editor: model.draft ?? reading(), failure: whyOf(error)},
	[],
];

/** The save landed: the editor reads again, and says what was saved. */
const saved = (model: Model): Step => {
	const answer = model.editor._tag === "saving" ? model.editor.answer : null;
	const chosen =
		answer?._tag === "rec" && model.ask.shows.rec._tag === "pick"
			? model.ask.shows.rec.pick
			: answer !== null && "pick" in answer
				? answer.pick
				: "Answer";
	return [
		{
			...model,
			editor: reading(),
			status: chosen === "approve" ? "Approved." : `${chosen} saved.`,
		},
		[answered({ticket: model.ticket})],
	];
};

const update = (model: Model, msg: Msg): Step => {
	switch (msg.type) {
		case "do": {
			if (model.editor._tag === "saving") return [model, []];
			const rec = model.ask.shows.rec;
			const now = msg.now ?? model.clock?.at ?? 0;
			switch (msg.value._tag) {
				case "rec":
					return rec._tag === "pick"
						? write(model, Answer.cases.rec.make({}), msg.key ?? "click", now)
						: [model, []];
				case "not": {
					if (rec._tag !== "pick") return [model, []];
					const others = model.ask.shows.picks.filter((p) => p.pick !== rec.pick);
					return others.length === 1 && others[0] !== undefined
						? pick(model, others[0].pick, msg.key ?? "click", now)
						: [{...model, editor: Editor.cases.picks.make({})}, []];
				}
				case "picks":
					return [{...model, editor: Editor.cases.picks.make({})}, []];
				case "later":
					return [model, [later({key: `${model.ticket}/${model.ask.ask}`})]];
			}
			return [model, []];
		}
		case "pick":
			return pick(model, msg.pick, msg.key ?? "click", msg.now ?? model.clock?.at ?? 0);
		case "note":
			return model.editor._tag === "note"
				? [{...model, editor: {...model.editor, text: msg.text}}, []]
				: [model, []];
		case "submit": {
			if (model.editor._tag !== "note") return [model, []];
			const value = {pick: model.editor.pick, note: model.editor.text.trim()};
			return Schema.is(Answer.cases.against)({_tag: "against", ...value})
				? write(model, Answer.cases.against.make(value), msg.key, msg.now)
				: [model, []];
		}
		case "mark": {
			if (model.editor._tag === "saving") return [model, []];
			const {needed: _needed, ...rest} = model;
			return [model.needed === msg.needed ? rest : {...rest, needed: msg.needed}, []];
		}
		case "focus":
		case "active":
		case "visible": {
			const next = timed(model, msg.now);
			const field = msg.type === "focus" ? "focused" : msg.type;
			return [{...next, clock: {...next.clock, [field]: msg.value}}, []];
		}
		case "tick":
			return [timed(model, msg.now), []];
		case "open": {
			const next = timed(model, msg.now);
			return [
				{
					...next,
					evidence: !next.evidence,
					took: {...next.took, opened: [...next.took.opened, msg.name]},
				},
				[],
			];
		}
		case "show": {
			const ask = Schema.decodeUnknownSync(Asked)(msg.ask);
			const next = timed(model, msg.now);
			return ask.ask === next.ask.ask
				? [next, []]
				: [
						{
							ticket: model.ticket,
							ask,
							editor: reading(),
							took: {ms: 0, opened: []},
							failure: null,
							clock: {...next.clock, at: msg.now},
						},
						[],
					];
		}
		case "save_ok":
			return saved(model);
		case "save_err":
			return failed(model, msg.error);
		case "escape":
			return model.editor._tag === "note" || model.editor._tag === "picks"
				? [{...model, editor: reading()}, []]
				: [model, []];
	}
};

type Ctx = {ticket: number; ask: unknown; now: number};
const init = (_loaded: unknown, ctx: Ctx): Step => [
	{
		ticket: ctx.ticket,
		ask: Schema.decodeUnknownSync(Asked)(ctx.ask),
		editor: reading(),
		took: {ms: 0, opened: []},
		failure: null,
		clock: {focused: false, visible: true, active: true, at: ctx.now},
	},
	[],
];
const machine = defineMachine({
	types: {model: {} as Model, msg: {} as Msg, ctx: {} as Ctx},
	cmds: [save, answered, later],
	init,
	update: {
		do: update,
		pick: update,
		note: update,
		submit: update,
		mark: update,
		focus: update,
		active: update,
		visible: update,
		open: update,
		show: update,
		tick: update,
		escape: update,
		save_ok: (s): Step => saved(s),
		save_err: (s, m): Step => failed(s, m.error),
		answered_ok: (s): Step => [s, []],
		later_ok: (s): Step => [s, []],
		// Neither cell can fail: these never come.
		answered_err: (s): Step => [s, []],
		later_err: (s): Step => [s, []],
	},
});
/** The shared ask editor. Its `init` keeps its own type, so a caller reads the first model as it is. */
export const askMachine = {...machine, init};

export type AskView = {
	key: string;
	ticket: number;
	shows: Shows;
	saw: string;
	editor: Editor;
	needed?: boolean;
	failure: string | null;
	busy: boolean;
};
export const askView = (input: {
	ticket: number;
	ask: unknown;
	editor: unknown;
	needed?: boolean;
	failure: string | null;
}): AskView => {
	const ask = Schema.decodeUnknownSync(Asked)(input.ask);
	const editor = Schema.decodeUnknownSync(Editor)(input.editor);
	return {
		key: `${input.ticket}/${ask.ask}`,
		ticket: input.ticket,
		shows: ask.shows,
		saw: ask.saw,
		editor,
		busy: editor._tag === "saving",
		failure: input.failure,
		...(input.needed === undefined ? {} : {needed: input.needed}),
	};
};
export type AskActions = {
	openLane: (ticket: number) => void;
	command: (
		press: {key: string; ctrl: boolean; alt: boolean; meta: boolean},
		typing: boolean,
	) => {key: string; value: AskCommand} | undefined;
	answer: (answer: AskAnswer) => Effect.Effect<unknown, {why: string}>;
	later: (key: string) => void;
	keys: Readonly<Record<AskCommand["_tag"], readonly string[]>>;
	blocked: () => boolean;
};
export const AskActions = createContext<AskActions | null>(null);

export function StopView({
	ticket,
	why,
	resume,
}: {
	readonly ticket: number;
	readonly why: string;
	readonly resume?: string;
}) {
	const actions = useContext(AskActions);
	return (
		<section className="ask-view" aria-label="Whose turn">
			<p>{why}</p>
			{resume !== undefined && <p>Resume at {resume}</p>}
			<Button variant="tertiary" onClick={() => actions?.openLane(ticket)}>
				Open lane
			</Button>
		</section>
	);
}
const runtime = ManagedRuntime.make(Layer.empty);
const run = runIn(runtime);
// Shared across mounts, so a held press cannot answer a newly mounted next ask.
const held = new Set<string>();

export function AskView({ticket, ask}: {readonly ticket: number; readonly ask: Asked}) {
	const actions = useContext(AskActions);
	const root = useRef<HTMLElement>(null);
	const note = useRef<HTMLTextAreaElement>(null);
	const ctx = useRef({ticket, ask, now: Date.now()}).current;
	const [model, send] = useMachine(askMachine, {
		run,
		ctx,
		interpret: {
			save: (cmd) =>
				actions === null
					? Effect.fail({_tag: "refused", why: "The host is disconnected"})
					: actions.answer(cmd).pipe(Effect.mapError((e) => ({_tag: "refused", why: e.why}))),
			answered: () =>
				Effect.sync(() => {
					const target = root.current?.closest<HTMLElement>(".program") ?? root.current;
					target?.focus();
				}),
			later: (cmd) => Effect.sync(() => actions?.later(cmd.key)),
		},
	});
	const view = askView(model);
	useEffect(() => {
		const up = (e: globalThis.KeyboardEvent) => held.delete(e.key);
		const active = () => {
			if (!document.hasFocus()) held.clear();
			send({type: "active", value: document.hasFocus(), now: Date.now()});
		};
		const visible = () => send({type: "visible", value: !document.hidden, now: Date.now()});
		window.addEventListener("keyup", up);
		window.addEventListener("blur", active);
		window.addEventListener("focus", active);
		document.addEventListener("visibilitychange", visible);
		active();
		visible();
		return () => {
			window.removeEventListener("keyup", up);
			window.removeEventListener("blur", active);
			window.removeEventListener("focus", active);
			document.removeEventListener("visibilitychange", visible);
		};
	}, [send]);
	useEffect(() => {
		if (view.editor._tag === "note") note.current?.focus();
	}, [view.editor._tag]);
	const command = (name: AskCommand["_tag"], key = "click") =>
		send({...ASK_COMMANDS[name].send, key, now: Date.now()});
	const onKey = (e: KeyboardEvent) => {
		const typing =
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLTextAreaElement ||
			(e.target instanceof HTMLElement && e.target.isContentEditable);
		if (e.key === "Escape" && (model.editor._tag === "note" || model.editor._tag === "picks")) {
			e.preventDefault();
			e.stopPropagation();
			send({type: "escape"});
			root.current?.focus();
			return;
		}
		if (typing || actions?.blocked()) return;
		const binding = actions?.command(
			{key: e.key, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey},
			typing,
		);
		const name =
			actions === null
				? (Object.keys(ASK_COMMANDS) as AskCommand["_tag"][]).find(
						(name) => !e.ctrlKey && !e.metaKey && !e.altKey && ASK_COMMANDS[name].keys === e.key,
					)
				: binding?.value._tag;
		if (name !== undefined) {
			e.preventDefault();
			e.stopPropagation();
			if (e.repeat || held.has(e.key)) return;
			held.add(e.key);
			command(name, binding?.key ?? e.key);
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (model.editor._tag === "picks" && /^[1-9]$/.test(e.key)) {
			const chosen = view.shows.picks[Number(e.key) - 1];
			if (chosen !== undefined) {
				e.preventDefault();
				e.stopPropagation();
				if (!e.repeat && !held.has(e.key)) {
					held.add(e.key);
					send({type: "pick", pick: chosen.pick, key: e.key, now: Date.now()});
				}
			}
		}
		if (e.key === " " && e.target === root.current) {
			e.preventDefault();
			send({type: "open", name: "evidence", now: Date.now()});
		}
	};
	const rec = view.shows.rec;
	return (
		<section
			ref={root}
			className="ask-view"

			aria-label={`ask: ${view.shows.what}`}
			tabIndex={-1}
			aria-busy={view.busy}
			data-ask-editor={view.editor._tag}
			onKeyDown={onKey}
			onFocus={() => send({type: "focus", value: true, now: Date.now()})}
			onBlur={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget))
					send({type: "focus", value: false, now: Date.now()});
			}}
		>
			<p className="ask-question">{view.shows.what}</p>
			{rec._tag === "pick" ? (
				<p className="ask-rec">
					{rec.pick}: {rec.why}
					<br />
					{rec.cost} · {rec.sure === null ? "confidence unknown" : `${rec.sure}% confidence`}
				</p>
			) : (
				<p className="ask-rec">
					{rec._tag === "none" ? rec.why : "Pick first. The recommendation is hidden for this ask."}
				</p>
			)}
			<div
				role="toolbar"
				aria-label="Answer"
				tabIndex={0}
				className="ask-toolbar"
				onKeyDown={(e) => {
					if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
					e.preventDefault();
					e.stopPropagation();
					const buttons = [
						...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
					];
					const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
					buttons[
						(at + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length
					]?.focus();
				}}
			>
				{(Object.keys(ASK_COMMANDS) as AskCommand["_tag"][])
					.filter((name) => name !== "later" && (rec._tag === "pick" || name === "picks"))
					.map((name) => {
						const keys = actions?.keys[name] ?? [ASK_COMMANDS[name].keys];
						return (
							<Button
								key={name}
								size="sm"
								variant={name === "rec" ? "primary" : "tertiary"}
								disabled={view.busy}
								aria-keyshortcuts={keys.length === 0 ? undefined : keys.join(" ")}
								onClick={() => command(name)}
							>
								{ASK_COMMANDS[name].label}
								{keys.length > 0 && <Kbd>{keys.join(" / ")}</Kbd>}
							</Button>
						);
					})}
			</div>
			<div className="ask-marks">
				{[
					[true, "Needed me"],
					[false, "Agent could work it out"],
				].map(([needed, label]) => (
					<Button
						key={String(needed)}
						size="sm"
						variant="tertiary"
						aria-pressed={view.needed === needed}
						disabled={view.busy}
						onClick={() => send({type: "mark", needed: needed === true})}
					>
						{label}
					</Button>
				))}
			</div>
			{view.editor._tag === "picks" && (
				<div className="ask-picks">
					{view.shows.picks.map((p, i) => (
						<Button
							key={p.pick}
							variant="tertiary"
							onClick={() => send({type: "pick", pick: p.pick, now: Date.now()})}
						>
							<Kbd>{i + 1}</Kbd>
							{p.pick}: {p.does}
						</Button>
					))}
				</div>
			)}
			{(view.editor._tag === "note" ||
				(model.editor._tag === "saving" && model.draft?._tag === "note")) && (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						send({type: "submit", key: "click", now: Date.now()});
					}}
				>
					<Textarea
						ref={note}
						label="Why this answer?"
						aria-label="Note against the recommendation"
						required
						maxLength={120}
						rows={2}
						disabled={view.busy}
						value={
							model.editor._tag === "note"
								? model.editor.text
								: model.draft?._tag === "note"
									? model.draft.text
									: ""
						}
						onChange={(e) => send({type: "note", text: e.target.value})}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								e.stopPropagation();
								if (!e.repeat) send({type: "submit", key: "Enter", now: Date.now()});
							}
						}}
					/>
					<Button type="submit" size="sm" variant="secondary" disabled={view.busy}>
						Send answer
					</Button>
				</form>
			)}
			{view.busy && <p>Saving answer…</p>}
			{view.failure !== null && <p role="alert">{view.failure}</p>}
			<Collapsible
				trigger="Evidence"
				open={model.evidence ?? false}
				onOpenChange={() => send({type: "open", name: "evidence", now: Date.now()})}
			>
				<div className="ask-evidence">
					<p>{view.shows.ticket.title}</p>
					<p>{view.shows.ticket.body}</p>
					<pre>{JSON.stringify(view.shows.evidence, null, 2)}</pre>
				</div>
			</Collapsible>
			<p role="status" aria-live="polite">
				{model.status ?? ""}
			</p>
		</section>
	);
}
