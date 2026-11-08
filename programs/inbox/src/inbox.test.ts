import {describe, expect, it} from "vitest";
import {AGENT, askRow, MESSAGE, messageRow, NOW, personRow} from "../../../fixtures/inbox/cases.ts";
import {
	fold,
	inboxSubject,
	type InboxMachine,
	type Msg,
	type State,
	step,
	project,
	replyFailure,
	replyResult,
} from "../../../fixtures/inbox/subject.ts";

const editing = (machine: InboxMachine) =>
	fold(machine, [
		{type: "arrive", row: messageRow},
		{type: "arrive", row: personRow},
		{type: "select", value: messageRow.key},
		{type: "reply", value: null},
		{type: "change", value: "Please fix it."},
	]).state;
const send: Msg = {type: "send", value: {id: "r18", said: NOW + 2}};
const sent = (machine: InboxMachine, state: State) => {
	const [next, cmds] = step(machine, state, send);
	const cmd = cmds.find((c) => c.type === "reply_send");
	expect(cmd, "Send must request real DM delivery").toBeDefined();
	if (cmd === undefined) throw new Error("Send requested no DM delivery");
	return {state: next, cmd};
};

describe("today's inbox reply laws", () => {
	it("I3: a message without a ticket remains readable and replyable", async () => {
		const {machine, tile, glance} = await inboxSubject("I3");
		const check = (on: InboxMachine) => {
			const state = editing(on);
			for (const view of [tile, glance])
				expect(project(view, state).rows).toContainEqual(messageRow);
			expect(state.reply).toMatchObject({
				_tag: "editing",
				message: MESSAGE.id,
				text: "Please fix it.",
			});
			expect(sent(on, state).cmd).toMatchObject({to: AGENT, replyTo: MESSAGE.id, ticket: null});
		};
		check(machine);
		// Plant I3: only messages with a positive ticket number may enter.
		const planted: InboxMachine = {
			...machine,
			update: {
				...machine.update,
				arrive: (state, msg) => {
					if (
						msg.row._tag === "message" &&
						!(Number(Reflect.get(Object(msg.row.message), "ticket")) > 0)
					)
						return [state, []];
					return machine.update.arrive(state, msg);
				},
			},
		};
		expect(() => check(planted)).toThrow();
	});

	it("I7: moving selection never changes the captured reply recipient or thread", async () => {
		const {machine} = await inboxSubject("I7");
		const check = (on: InboxMachine) => {
			const state = fold(on, [{type: "select", value: personRow.key}], editing(on)).state;
			expect(state.selected).toBe(personRow.key);
			expect(sent(on, state).cmd).toMatchObject({
				to: AGENT,
				thread: MESSAGE.thread,
				replyTo: MESSAGE.id,
				text: "Please fix it.",
			});
		};
		check(machine);
		// Plant I7: send to the row selected now instead of the captured message.
		const planted: InboxMachine = {
			...machine,
			update: {
				...machine.update,
				send: (state, msg) => {
					const [next, out] = machine.update.send(state, msg);
					return [
						next,
						out.map((c) => (c.type === "reply_send" ? {...c, replyTo: state.selected} : c)),
					];
				},
			},
		};
		expect(() => check(planted)).toThrow();
	});

	it("I8: a failed send keeps text and ID, retry reuses them, and queued is not delivered", async () => {
		const {machine} = await inboxSubject("I8");
		const check = (on: InboxMachine) => {
			const first = sent(on, editing(on));
			const failed = fold(on, [replyFailure(first.cmd, "connection dropped")], first.state).state;
			expect(failed.reply).toMatchObject({
				_tag: "failed",
				id: "r18",
				text: "Please fix it.",
				why: "connection dropped",
			});
			const retry = fold(on, [{type: "retry", value: null}], failed);
			expect(retry.cmds.find((c) => c.type === "reply_send")).toEqual(first.cmd);
			const queued = fold(on, [replyResult(first.cmd, "queued")], retry.state).state;
			expect(queued.reply._tag).not.toBe("delivered");
			const late = fold(
				on,
				[replyResult({...first.cmd, id: "unrelated"}, "delivered")],
				failed,
			).state;
			expect(late.reply).toEqual(failed.reply);
		};
		check(machine);
		// Plant I8: retry has a fresh id, allowing duplicate writes after a lost acknowledgement.
		const planted: InboxMachine = {
			...machine,
			update: {
				...machine.update,
				retry: (state, msg) => {
					const [next, out] = machine.update.retry(state, msg);
					return [
						next,
						out.map((c) => (c.type === "reply_send" ? {...c, id: "fresh-on-retry"} : c)),
					];
				},
			},
		};
		expect(() => check(planted)).toThrow();
	});

	it("I6: first Escape closes the reply and keeps its draft for reopening", async () => {
		const {machine} = await inboxSubject("I6");
		const before = editing(machine);
		const closed = fold(machine, [{type: "escape", value: null}], before);
		expect(closed.state.reply._tag).toBe("closed");
		expect(closed.cmds.some((c) => c.type === "open" || c.type === "leave")).toBe(false);
		const again = fold(machine, [{type: "reply", value: null}], closed.state).state;
		expect(again.reply).toMatchObject({
			_tag: "editing",
			message: MESSAGE.id,
			text: "Please fix it.",
		});
	});

	it("I11: restart restores acknowledged rows, pending reply IDs and Later/Seen marks", async () => {
		const {machine} = await inboxSubject("I11");
		const ask = await askRow();
		const first = editing(machine);
		const marked = fold(
			machine,
			[
				{type: "arrive", row: ask},
				{type: "select", value: ask.key},
				{type: "seen", value: null},
				{type: "later", value: null},
			],
			first,
		).state;
		const pending = sent(machine, marked).state;
		const saved: State = JSON.parse(JSON.stringify(pending));
		const [back, cmds] = machine.init(saved, undefined);
		expect(back.rows).toEqual(pending.rows);
		expect(back.marks.later).toContain(ask.key);
		expect(back.marks.seen).toContain(ask.key);
		expect(back.reply).toMatchObject({id: "r18", text: "Please fix it."});
		for (const cmd of cmds.filter((c) => c.type === "reply_send")) expect(cmd.id).toBe("r18");
		// Plant I11: a restart throws the saved model away.
		expect(() => {
			const [empty] = machine.init(null, undefined);
			expect(empty.rows).toEqual(pending.rows);
		}).toThrow();
	});
});
