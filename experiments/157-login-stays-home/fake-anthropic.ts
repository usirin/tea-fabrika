// Experiment 157's fake Anthropic: the Messages API, enough for Claude Code, on the shapes of
// experiment 137's stand-in (`137-key-outside-the-box/standin.ts`). Nothing here talks to
// Anthropic.
//
//   POST /v1/messages   a login's token as a bearer, with the OAuth beta. Claude Code's main loop
//                       (it offers the Bash tool) first gets one Bash call; the call that carries
//                       its result gets a text answer that quotes it. Any other call gets "ok".
//
// A Claude login is one long-lived token, as `claude setup-token` makes: nothing to renew. The
// real token's prefix is left out on purpose, so no secret scanner takes a fake for a real one.
//
// Node at the edge: node:http.
import {randomBytes} from "node:crypto";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import type {AddressInfo} from "node:net";
import {TOOL_PRINTS} from "./fake-openai.ts";

export interface ClaudeCall {
	readonly who: string | null;
	readonly why: "ok" | "no_bearer" | "unknown" | "no_oauth_beta";
	readonly run: string | null;
	readonly answer: "tool" | "text" | "side" | "refused";
	readonly toolOutput: string | null;
	readonly at: number;
}

export interface FakeAnthropic {
	readonly url: string;
	readonly calls: readonly ClaudeCall[];
	readonly secrets: () => readonly string[];
	readonly secretsOf: (who: string) => readonly string[];
	/** A login for `who`: one token. */
	readonly issue: (who: string) => {readonly token: string};
	readonly close: () => Promise<void>;
}

/** The one tool call: Bash runs the same check as Codex's, in the box's copy. */
export const BASH = `node -e "import('./bytes.js').then((m) => console.log('formatBytes(2048) =', m.formatBytes(2048)))"`;

let ids = 0;

const events = (model: string, block: {text: string} | {command: string}) => {
	const id = `${++ids}`.padStart(6, "0");
	const usage = {
		input_tokens: 10,
		output_tokens: 1,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: 0,
	};
	const tool = "command" in block;
	const start = tool
		? {type: "tool_use", id: `toolu_fake${id}`, name: "Bash", input: {}}
		: {type: "text", text: ""};
	const deltas = tool
		? [
				{
					type: "input_json_delta",
					partial_json: JSON.stringify({command: block.command, description: "Run the check"}),
				},
			]
		: [block.text.slice(0, 10), block.text.slice(10, 24), block.text.slice(24)].map((text) => ({
				type: "text_delta",
				text,
			}));
	const stop = tool ? "tool_use" : "end_turn";
	return [
		{
			type: "message_start",
			message: {
				id: `msg_fake${id}`,
				type: "message",
				role: "assistant",
				model,
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage,
			},
		},
		{type: "content_block_start", index: 0, content_block: start},
		...deltas.map((delta) => ({type: "content_block_delta", index: 0, delta})),
		{type: "content_block_stop", index: 0},
		{
			type: "message_delta",
			delta: {stop_reason: stop, stop_sequence: null},
			usage: {output_tokens: 10},
		},
		{type: "message_stop"},
	];
};

const textOf = (content: unknown): string =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content
					.map((c) => (typeof c === "object" && c !== null && "text" in c ? String(c.text) : ""))
					.join("")
			: "";

export const startFakeAnthropic = (): Promise<FakeAnthropic> => {
	const calls: ClaudeCall[] = [];
	const tokens = new Map<string, string>();

	const handle = (req: IncomingMessage, res: ServerResponse) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", async () => {
			const raw = Buffer.concat(chunks).toString("utf8");
			const path = new URL(req.url ?? "/", "http://fake").pathname;
			const auth = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
			const who = auth === undefined ? undefined : tokens.get(auth);
			const betas = String(req.headers["anthropic-beta"] ?? "").split(",");
			const run = /\[\[run:([a-z0-9-]+)\]\]/.exec(raw)?.[1] ?? null;
			const why: ClaudeCall["why"] =
				auth === undefined
					? "no_bearer"
					: who === undefined
						? "unknown"
						: !betas.includes("oauth-2025-04-20")
							? "no_oauth_beta"
							: "ok";
			if (req.method !== "POST" || path !== "/v1/messages" || why !== "ok") {
				calls.push({who: null, why, run, answer: "refused", toolOutput: null, at: Date.now()});
				res.writeHead(401, {"content-type": "application/json"});
				res.end(
					JSON.stringify({type: "error", error: {type: "authentication_error", message: why}}),
				);
				return;
			}
			let body: {
				model?: string;
				stream?: boolean;
				tools?: {name?: string}[];
				messages?: {role: string; content: unknown}[];
			} = {};
			try {
				body = JSON.parse(raw);
			} catch {
				// Answered as a side call below.
			}
			const main = (body.tools ?? []).some((t) => t.name === "Bash");
			const last = (body.messages ?? []).at(-1);
			const result = Array.isArray(last?.content)
				? last.content.find(
						(b): b is {type: string; content?: unknown} =>
							typeof b === "object" && b !== null && "type" in b && b.type === "tool_result",
					)
				: undefined;
			const toolOutput = result === undefined ? null : textOf(result.content);
			const answer = !main ? "side" : toolOutput === null ? "tool" : "text";
			calls.push({who: who ?? null, why, run, answer, toolOutput, at: Date.now()});
			const model = body.model ?? "claude-haiku-4-5";
			const block =
				answer === "tool"
					? {command: BASH}
					: {
							text:
								answer === "side"
									? "ok"
									: `The command printed: ${toolOutput?.includes(TOOL_PRINTS) ? TOOL_PRINTS : "something else"}`,
						};
			if (body.stream !== true) {
				// A call that does not stream gets the same message whole.
				const content =
					"command" in block
						? [{type: "tool_use", id: `toolu_fake${++ids}`, name: "Bash", input: {command: BASH}}]
						: [{type: "text", text: block.text}];
				res.writeHead(200, {"content-type": "application/json", "request-id": `req_fake${ids}`});
				res.end(
					JSON.stringify({
						id: `msg_fake${ids}`,
						type: "message",
						role: "assistant",
						model,
						content,
						stop_reason: "command" in block ? "tool_use" : "end_turn",
						stop_sequence: null,
						usage: {input_tokens: 10, output_tokens: 10},
					}),
				);
				return;
			}
			res.writeHead(200, {"content-type": "text/event-stream", "request-id": `req_fake${ids}`});
			for (const e of events(model, block)) {
				res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
				await new Promise((r) => setTimeout(r, 5));
			}
			res.end();
		});
	};

	const server = createServer(handle);
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => {
			resolve({
				url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
				calls,
				secrets: () => [...tokens.keys()],
				secretsOf: (who) => [...tokens].flatMap(([t, w]) => (w === who ? [t] : [])),
				issue: (who) => {
					const token = `fake-claude-${randomBytes(20).toString("hex")}`;
					tokens.set(token, who);
					return {token};
				},
				close: () =>
					new Promise((r) => {
						server.closeAllConnections();
						server.close(() => r());
					}),
			});
		}),
	);
};
