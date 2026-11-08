import {defineMachine, noop} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {MessageReceipt, MessageDelivery, Writer} from "@kampus/fabrika-old";
import {Asked, Shows} from "@kampus/pipeline/tickets/ask";
import {Schema} from "effect";

const Message = Schema.Struct({
	id: Schema.String,
	thread: Schema.String,
	by: Writer,
	at: Schema.Finite,
	said: Schema.NullOr(Schema.Finite),
	text: Schema.String,
	replyTo: Schema.NullOr(Schema.String),
	ticket: Schema.NullOr(Schema.Int),
});
const Ask = Schema.Struct({
	key: Schema.String,
	ticket: Schema.Int,
	shows: Shows,
	saw: Schema.String,
	editor: Schema.Unknown,
	failure: Schema.NullOr(Schema.String),
	busy: Schema.Boolean,
	needed: Schema.optionalKey(Schema.Boolean),
	at: Schema.Finite,
	sealed: Schema.optionalKey(Asked),
});
const Stop = Schema.Struct({
	ticket: Schema.Int,
	why: Schema.String,
	resume: Schema.optionalKey(Schema.String),
	at: Schema.Finite,
});
export const InboxRow = Schema.TaggedUnion({
	ask: {key: Schema.String, ask: Ask},
	stop: {key: Schema.String, stop: Stop},
	message: {key: Schema.String, message: Message},
});
export type InboxRow = typeof InboxRow.Type;
const captured = {
	row: Schema.String,
	message: Schema.String,
	to: Writer,
	thread: Schema.String,
	ticket: Schema.NullOr(Schema.Int),
	text: Schema.String,
};
const pending = {...captured, id: Schema.String, said: Schema.Finite};
const Reply = Schema.TaggedUnion({
	closed: {},
	editing: captured,
	sending: pending,
	failed: {...pending, why: Schema.String},
	queued: pending,
	delivered: pending,
});
type Reply = typeof Reply.Type;
export const InboxState = Schema.Struct({
	rows: Schema.Array(InboxRow),
	selected: Schema.NullOr(Schema.String),
	look: Schema.Boolean,
	reply: Reply,
	drafts: Schema.Record(Schema.String, Reply),
	marks: Schema.Struct({later: Schema.Array(Schema.String), seen: Schema.Array(Schema.String)}),
});
export type InboxState = typeof InboxState.Type;
const replySend = Cmd.make("reply_send", {
	input: MessageDelivery,
	ok: MessageReceipt,
	err: ["refused"],
});
const open = Cmd.make("open", {
	input: Schema.Struct({
		row: Schema.NullOr(Schema.String),
		destination: Schema.Boolean,
		looked: Schema.Boolean,
	}),
	ok: Schema.Null,
	err: [],
});
const leave = Cmd.make("leave", {input: Schema.Struct({}), ok: Schema.Null, err: []});
export type InboxCommand =
	| ReturnType<typeof replySend>
	| ReturnType<typeof open>
	| ReturnType<typeof leave>;
type Command = InboxCommand;
export type InboxMsg =
	| {type: "mark"; key: string; later: boolean}
	| {type: "receipt"; id: string; value: typeof MessageReceipt.Type}
	| {type: "arrive"; row: InboxRow}
	| {type: "sync"; rows: readonly InboxRow[]}
	| {type: "answered"; key: string}
	| {type: "move"; value: number}
	| {type: "select"; value: string}
	| {type: "change"; value: string}
	| {type: "send"; value: {id: string; said: number}}
	| {type: "reply"; value: null}
	| {type: "retry"; value: null}
	| {type: "escape"; value: null}
	| {type: "look"; value: null}
	| {type: "open"; value: null}
	| {type: "enter"; value: null}
	| {type: "later"; value: null}
	| {type: "seen"; value: null}
	| {
			type: "reply_send_ok";
			cmd: ReturnType<typeof replySend>;
			value: typeof MessageReceipt.Type;
			at: number;
	  }
	| {type: "reply_send_err"; cmd: ReturnType<typeof replySend>; error: {why: string}; at: number};
type Step = readonly [InboxState, readonly Command[]];
const closed = () => Reply.cases.closed.make({});
const fields = <A extends {_tag: string}>({_tag, ...value}: A) => value;
const pendingFields = (reply: Extract<Reply, {id: string}>) => ({
	row: reply.row,
	message: reply.message,
	to: reply.to,
	thread: reply.thread,
	ticket: reply.ticket,
	text: reply.text,
	id: reply.id,
	said: reply.said,
});
const result = (
	s: InboxState,
	id: string,
	to: (reply: Extract<Reply, {id: string}>) => Reply,
): Step => {
	if ("id" in s.reply && s.reply.id === id) return [{...s, reply: to(s.reply)}, []];
	const draft = Object.entries(s.drafts).find(([, reply]) => "id" in reply && reply.id === id);
	return draft !== undefined && "id" in draft[1]
		? [{...s, drafts: {...s.drafts, [draft[0]]: to(draft[1])}}, []]
		: [s, []];
};
const ordered = (rows: readonly InboxRow[]) => [
	...rows
		.filter((r) => r._tag !== "message")
		.sort(
			(a, b) =>
				(a._tag === "ask" ? a.ask.at : a._tag === "stop" ? a.stop.at : 0) -
				(b._tag === "ask" ? b.ask.at : b._tag === "stop" ? b.stop.at : 0),
		),
	...rows.filter((r) => r._tag === "message"),
];
const withRows = (s: InboxState, rows: readonly InboxRow[]): InboxState => {
	const at = s.rows.findIndex((r) => r.key === s.selected);
	const next = ordered(rows);
	const selected = next.some((r) => r.key === s.selected)
		? s.selected
		: (s.rows.slice(at + 1).find((r) => next.some((n) => n.key === r.key))?.key ??
			s.rows.slice(0, Math.max(at, 0)).findLast((r) => next.some((n) => n.key === r.key))?.key ??
			next[0]?.key ??
			null);
	return {...s, rows: next, selected};
};
const sending = (s: InboxState, reply: Extract<Reply, {id: string}>): Step => [
	{...s, reply: Reply.cases.sending.make(pendingFields(reply))},
	[
		replySend({
			id: reply.id,
			to: reply.to,
			text: reply.text,
			thread: reply.thread,
			replyTo: reply.message,
			ticket: reply.ticket,
			said: reply.said,
		}),
	],
];
const init = (saved: InboxState | null): Step => [
	saved === null
		? {
				rows: [],
				selected: null,
				look: false,
				reply: closed(),
				drafts: {},
				marks: {later: [], seen: []},
			}
		: {
				...saved,
				reply:
					saved.reply._tag === "sending"
						? Reply.cases.failed.make({
								...fields(saved.reply),
								why: "The host restarted. Retry this reply.",
							})
						: saved.reply,
			},
	[],
];
export const inboxMachine = defineMachine({
	types: {model: {} as InboxState, msg: {} as InboxMsg},
	cmds: [replySend, open, leave],
	init,
	update: {
		mark: (s, m): Step => [
			{
				...s,
				marks: {
					...s.marks,
					later: m.later
						? [...new Set([...s.marks.later, m.key])]
						: s.marks.later.filter((key) => key !== m.key),
				},
			},
			[],
		],
		receipt: (s, m): Step =>
			result(s, m.id, (reply) =>
				reply._tag === "delivered" ? reply : Reply.cases[m.value._tag].make(pendingFields(reply)),
			),
		arrive: (s, m): Step => [
			withRows(s, [...s.rows.filter((r) => r.key !== m.row.key), m.row]),
			[],
		],
		sync: (s, m): Step => [
			withRows(s, [...m.rows, ...s.rows.filter((r) => r._tag === "message")]),
			[],
		],
		answered: (s, m): Step => [
			withRows(
				s,
				s.rows.filter((r) => r.key !== m.key),
			),
			[],
		],
		select: (s, m): Step => [
			s.rows.some((r) => r.key === m.value) ? {...s, selected: m.value} : s,
			[],
		],
		move: (s, m): Step => {
			const at = s.rows.findIndex((r) => r.key === s.selected);
			const row = s.rows[Math.max(0, Math.min(s.rows.length - 1, at + m.value))];
			return [{...s, selected: row?.key ?? null}, []];
		},
		later: (s): Step => [
			s.selected === null
				? s
				: {
						...s,
						marks: {
							...s.marks,
							later: s.marks.later.includes(s.selected)
								? s.marks.later.filter((key) => key !== s.selected)
								: [...s.marks.later, s.selected],
						},
					},
			[],
		],
		seen: (s): Step => [
			{
				...s,
				marks: {...s.marks, seen: [...new Set([...s.marks.seen, ...s.rows.map((r) => r.key)])]},
			},
			[],
		],
		reply: (s): Step => {
			const row = s.rows.find((r) => r.key === s.selected);
			if (row?._tag !== "message" || s.reply._tag === "sending") return [s, []];
			const drafts = s.reply._tag === "closed" ? s.drafts : {...s.drafts, [s.reply.row]: s.reply};
			const kept = drafts[row.key];
			const reply =
				kept !== undefined && kept._tag !== "closed"
					? kept
					: Reply.cases.editing.make({
							row: row.key,
							message: row.message.id,
							to: row.message.by,
							thread: row.message.thread,
							ticket: row.message.ticket,
							text: "",
						});
			return [{...s, reply, drafts}, []];
		},
		change: (s, m): Step => [
			s.reply._tag === "editing" || s.reply._tag === "failed"
				? {...s, reply: {...s.reply, text: m.value}}
				: s,
			[],
		],
		send: (s, m): Step =>
			s.reply._tag === "editing" && s.reply.text.trim() !== ""
				? sending(s, Reply.cases.sending.make({...fields(s.reply), ...m.value}))
				: [s, []],
		retry: (s): Step => (s.reply._tag === "failed" ? sending(s, s.reply) : [s, []]),
		reply_send_ok: (s, m): Step =>
			result(s, m.cmd.id, (reply) =>
				reply._tag === "delivered" ? reply : Reply.cases[m.value._tag].make(pendingFields(reply)),
			),
		reply_send_err: (s, m): Step =>
			result(s, m.cmd.id, (reply) =>
				reply._tag === "delivered"
					? reply
					: Reply.cases.failed.make({
							...pendingFields(reply),
							why:
								"why" in m.error && typeof m.error.why === "string"
									? m.error.why
									: "The reply was not accepted",
						}),
			),
		look: (s): Step => [{...s, look: s.selected !== null && !s.look}, []],
		escape: (s): Step =>
			s.reply._tag !== "closed"
				? [{...s, drafts: {...s.drafts, [s.reply.row]: s.reply}, reply: closed()}, []]
				: s.look
					? [{...s, look: false}, []]
					: [s, [leave({})]],
		open: (s): Step => [s, [open({row: s.selected, destination: false, looked: s.look})]],
		enter: (s): Step => [s, [open({row: s.selected, destination: true, looked: s.look})]],
		open_ok: noop,
		open_err: noop,
		leave_ok: noop,
		leave_err: noop,
	},
});
