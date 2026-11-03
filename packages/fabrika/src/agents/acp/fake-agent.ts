import {appendFileSync, existsSync, mkdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {Readable, Writable} from "node:stream";
import * as acp from "@agentclientprotocol/sdk/unstable";

// A scripted ACP agent: the official library's `agent()` app over stdio,
// with no model behind it. It stands in for a harness in tests and in CI,
// and it is the second harness of experiment 76 where a real one could not
// be contained. `acp --agent fake` starts it (./harness.ts).
//
// It is a process of its own, spoken to only through ACP, so it is plain
// Node: stdin and stdout to Web Streams, files for its history. Nothing here
// is part of the program.
//
// What a prompt makes it do, by the words in it:
//
//   a.txt b.txt   one Read tool call per file named, pending → in_progress → completed; the answer quotes each file
//   plan          a two-step plan
//   mode          the mode moves to `plan`
//   title         the session gets a title
//   think         two thought chunks
//   write         an edit tool call that asks permission first, its input in the ask; allowed, it writes `written.txt`
//   slowly        a second's pause before each step: a turn to cancel, or to kill
//
// Each session is kept in `<folder>/.fake-acp/<id>.jsonl`, every update it
// sent with the prompt that led to it, so `session/load` can replay it and
// `session/resume` can find it. Each prompt is noted in `<folder>/.fake-acp/log`
// as `prompt <session> <n> <its first word>`, for a test to count. A system
// prompt handed in `_meta.system` on new, load or resume is noted there too,
// as `system <session> <its JSON>`, so a test sees exactly what came.

type Update = acp.SessionUpdate;

const noteSystem = (id: string, meta: Record<string, unknown> | null | undefined) => {
	if (meta?.system !== undefined) note(`system ${id} ${JSON.stringify(meta.system)}`);
};

const here = process.cwd();
const home = join(here, ".fake-acp");
mkdirSync(home, {recursive: true});
const historyOf = (id: string) => join(home, `${id}.jsonl`);
const note = (line: string) => appendFileSync(join(home, "log"), `${line}\n`);

interface Session {
	mode: string;
	model: string;
	effort: string;
	turns: number;
	used: number;
	cancelled: boolean;
}
const sessions = new Map<string, Session>();

const MODES = ["default", "auto", "plan"];
const configOf = (s: Session): acp.SessionConfigOption[] => [
	{
		id: "mode",
		name: "Mode",
		category: "mode",
		type: "select",
		currentValue: s.mode,
		options: MODES.map((m) => ({value: m, name: m})),
	},
	{
		id: "model",
		name: "Model",
		category: "model",
		type: "select",
		currentValue: s.model,
		options: ["fake-small", "fake-large"].map((m) => ({value: m, name: m})),
	},
	{
		id: "effort",
		name: "Effort",
		category: "thought_level",
		type: "select",
		currentValue: s.effort,
		options: ["low", "medium", "high"].map((m) => ({value: m, name: m})),
	},
];
const modesOf = (s: Session): acp.SessionModeState => ({
	currentModeId: s.mode,
	availableModes: MODES.map((id) => ({id, name: id})),
});

const fresh = (): Session => ({
	mode: "auto",
	model: "fake-small",
	effort: "medium",
	turns: 0,
	used: 0,
	cancelled: false,
});

/** A session kept on disk: its turns, counted from its prompts. */
const loaded = (id: string): {readonly session: Session; readonly updates: Update[]} | null => {
	if (!existsSync(historyOf(id))) return null;
	const updates = readFileSync(historyOf(id), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Update);
	const session = fresh();
	session.turns = updates.filter((u) => u.sessionUpdate === "user_message_chunk").length;
	return {session, updates};
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const app = acp
	.agent({name: "fake"})
	.onRequest(acp.methods.agent.initialize, () => ({
		protocolVersion: acp.PROTOCOL_VERSION,
		agentCapabilities: {loadSession: true, sessionCapabilities: {resume: {}}},
		agentInfo: {name: "fake", version: "0"},
	}))
	.onRequest(acp.methods.agent.session.new, (ctx) => {
		const id = `fake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const session = fresh();
		sessions.set(id, session);
		appendFileSync(historyOf(id), "");
		noteSystem(id, ctx.params._meta);
		return {sessionId: id, modes: modesOf(session), configOptions: configOf(session)};
	})
	.onRequest(acp.methods.agent.session.load, async (ctx) => {
		const found = loaded(ctx.params.sessionId);
		if (found === null) throw acp.RequestError.resourceNotFound(ctx.params.sessionId);
		sessions.set(ctx.params.sessionId, found.session);
		noteSystem(ctx.params.sessionId, ctx.params._meta);
		for (const update of found.updates)
			await ctx.client.notify(acp.methods.client.session.update, {
				sessionId: ctx.params.sessionId,
				update,
			});
		return {modes: modesOf(found.session), configOptions: configOf(found.session)};
	})
	.onRequest(acp.methods.agent.session.resume, (ctx) => {
		const found = loaded(ctx.params.sessionId);
		if (found === null) throw acp.RequestError.resourceNotFound(ctx.params.sessionId);
		sessions.set(ctx.params.sessionId, found.session);
		noteSystem(ctx.params.sessionId, ctx.params._meta);
		return {modes: modesOf(found.session), configOptions: configOf(found.session)};
	})
	.onRequest(acp.methods.agent.session.setConfigOption, (ctx) => {
		const s = sessions.get(ctx.params.sessionId);
		if (s === undefined) throw acp.RequestError.resourceNotFound(ctx.params.sessionId);
		const value = String(ctx.params.value);
		if (ctx.params.configId === "mode") s.mode = value;
		if (ctx.params.configId === "model") s.model = value;
		if (ctx.params.configId === "effort") s.effort = value;
		return {configOptions: configOf(s)};
	})
	.onNotification(acp.methods.agent.session.cancel, (ctx) => {
		const s = sessions.get(ctx.params.sessionId);
		if (s !== undefined) s.cancelled = true;
	})
	.onRequest(acp.methods.agent.session.prompt, async (ctx) => {
		const sessionId = ctx.params.sessionId;
		const s = sessions.get(sessionId);
		if (s === undefined) throw acp.RequestError.resourceNotFound(sessionId);
		s.cancelled = false;
		s.turns += 1;
		const text = ctx.params.prompt
			.map((block) => (block.type === "text" ? block.text : ""))
			.join("");
		note(`prompt ${sessionId} ${s.turns} ${text.split(/\s+/)[0] ?? ""}`);
		const slow = /\bslowly\b/.test(text);
		const keep = (update: Update) =>
			appendFileSync(historyOf(sessionId), `${JSON.stringify(update)}\n`);
		const send = async (update: Update) => {
			keep(update);
			await ctx.client.notify(acp.methods.client.session.update, {sessionId, update});
		};
		/** One step of the turn: false once the turn was cancelled. */
		const step = async () => {
			if (slow) await pause(1_000);
			return !s.cancelled;
		};
		keep({sessionUpdate: "user_message_chunk", content: {type: "text", text}});

		const turn = async (): Promise<acp.StopReason> => {
			if (/\bthink\b/.test(text)) {
				await send({sessionUpdate: "agent_thought_chunk", content: {type: "text", text: "hmm"}});
				await send({sessionUpdate: "agent_thought_chunk", content: {type: "text", text: "ok"}});
			}
			if (/\bplan\b/.test(text))
				await send({
					sessionUpdate: "plan",
					entries: [
						{content: "read the files", priority: "high", status: "in_progress"},
						{content: "answer", priority: "medium", status: "pending"},
					],
				});
			if (/\bmode\b/.test(text)) {
				s.mode = "plan";
				await send({sessionUpdate: "current_mode_update", currentModeId: "plan"});
			}
			if (/\btitle\b/.test(text))
				await send({sessionUpdate: "session_info_update", title: "A fake session"});
			const quotes: string[] = [];
			const files = [...new Set(text.match(/\b[\w-]+\.txt\b/g) ?? [])];
			for (const [i, file] of files.entries()) {
				if (!(await step())) return "cancelled";
				const id = `t${s.turns}.${i + 1}`;
				await send({
					sessionUpdate: "tool_call",
					toolCallId: id,
					name: "Read",
					kind: "read",
					title: `Read ${file}`,
					status: "pending",
				});
				await send({sessionUpdate: "tool_call_update", toolCallId: id, status: "in_progress"});
				const at = join(here, file);
				const there = existsSync(at);
				quotes.push(there ? `${file}: ${readFileSync(at, "utf8").trim()}` : `${file}: not there`);
				await send({
					sessionUpdate: "tool_call_update",
					toolCallId: id,
					status: there ? "completed" : "failed",
				});
			}
			if (/\bwrite\b/.test(text)) {
				if (!(await step())) return "cancelled";
				const id = `t${s.turns}.w`;
				const call = {
					toolCallId: id,
					name: "Write",
					kind: "edit" as const,
					title: "Write written.txt",
					// What Claude's adapter sends: the tool's own input, for a client's check to read.
					rawInput: {file_path: join(here, "written.txt"), content: "written\n"},
				};
				await send({sessionUpdate: "tool_call", ...call, status: "pending"});
				const answer = await ctx.client.request<
					acp.RequestPermissionResponse,
					acp.RequestPermissionRequest
				>(acp.methods.client.session.requestPermission, {
					sessionId,
					toolCall: call,
					options: [
						{optionId: "yes", name: "Allow once", kind: "allow_once"},
						{optionId: "always", name: "Always allow", kind: "allow_always"},
						{optionId: "no", name: "Reject", kind: "reject_once"},
						{optionId: "never", name: "Always reject", kind: "reject_always"},
					],
				});
				const allowed =
					answer.outcome.outcome === "selected" &&
					(answer.outcome.optionId === "yes" || answer.outcome.optionId === "always");
				if (allowed) appendFileSync(join(here, "written.txt"), "written\n");
				quotes.push(allowed ? "wrote written.txt" : "was not allowed to write");
				await send({
					sessionUpdate: "tool_call_update",
					toolCallId: id,
					status: allowed ? "completed" : "failed",
				});
				if (answer.outcome.outcome === "cancelled") return "cancelled";
			}
			if (!(await step())) return "cancelled";
			const said = quotes.length === 0 ? [`Turn ${s.turns}: noted.`] : quotes;
			const messageId = `m${s.turns}`;
			for (const [i, line] of said.entries())
				await send({
					sessionUpdate: "agent_message_chunk",
					messageId,
					content: {type: "text", text: i === 0 ? line : `\n${line}`},
				});
			return "end_turn";
		};

		const stopReason = await turn();
		const input = 100 + text.length;
		const output = 10;
		s.used += input + output;
		await send({sessionUpdate: "usage_update", used: s.used, size: 200_000});
		return {
			stopReason,
			usage: {inputTokens: input, outputTokens: output, totalTokens: input + output},
		};
	});

const connection = app.connect(
	acp.ndJsonStream(
		Writable.toWeb(process.stdout),
		Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
	),
);
// Its client gone (stdin closed), it ends: a killed tsh leaves no fake agent behind.
await connection.closed;
process.exit(0);
