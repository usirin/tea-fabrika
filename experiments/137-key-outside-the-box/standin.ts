// Experiment 137, part 1's upstream: a stand-in for the Messages API, on the host.
//
// Part 1 holds a made-up key only, so no real model can answer. The relay sends the box's calls
// here instead. The stand-in answers like the API does (a stream of events), and asks for the
// probe's tool calls in order, one a turn. So Claude Code's real tools run inside the box, but no
// real model picks them: the probes are the same in every box and every run.
//
// It knows the fake key, because it stands for the API, which is outside every box too. It checks
// that each request came with the key (the relay added it) and that no request body carries the
// key (nothing in the box read it and sent it on).
//
// Node at the edge: it is an HTTP server.

import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import type {AddressInfo} from "node:net";

/** One tool call the stand-in asks for. */
export interface Step {
	readonly tool: "Bash" | "Read";
	readonly input: Readonly<Record<string, unknown>>;
}

/** One request as the stand-in saw it. */
export interface Arrived {
	readonly path: string;
	/** It carried the fake key as the relay adds it. */
	readonly keyed: boolean;
	/** It carried a credential header the relay should have dropped: an `x-api-key`, or an `authorization` that is not the key. */
	readonly stray: boolean;
	/** The main loop's request (it offers the tools); `null` for any other. */
	readonly step: number | null;
	/** Some text of the request body holds the key. */
	readonly keyInBody: boolean;
}

export interface StandIn {
	readonly port: number;
	readonly arrived: readonly Arrived[];
	/** What the tool calls sent back, by step, as Claude Code passed them on. */
	readonly results: ReadonlyMap<number, {readonly text: string; readonly error: boolean}>;
	readonly close: () => Promise<void>;
}

const sse = (res: ServerResponse, events: readonly Record<string, unknown>[]) => {
	res.writeHead(200, {"content-type": "text/event-stream", "request-id": "req_standin"});
	for (const e of events) res.write(`event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`);
	res.end();
};

let ids = 0;

/** An answer of one content block, as the API streams it. */
const answer = (
	model: string,
	block: {kind: "text"; text: string} | {kind: "tool"; step: Step},
) => {
	const id = `${++ids}`.padStart(6, "0");
	const usage = {
		input_tokens: 10,
		output_tokens: 1,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: 0,
	};
	const tool = {type: "tool_use", id: `toolu_standin${id}`, name: "", input: {}};
	const start = block.kind === "text" ? {type: "text", text: ""} : {...tool, name: block.step.tool};
	const delta =
		block.kind === "text"
			? {type: "text_delta", text: block.text}
			: {type: "input_json_delta", partial_json: JSON.stringify(block.step.input)};
	const content =
		block.kind === "text"
			? {type: "text", text: block.text}
			: {...tool, name: block.step.tool, input: block.step.input};
	const stop = block.kind === "text" ? "end_turn" : "tool_use";
	const message = {
		id: `msg_standin${id}`,
		type: "message",
		role: "assistant",
		model,
		stop_sequence: null,
	};
	return {
		/** The message whole, for a request that does not stream. */
		whole: {
			...message,
			content: [content],
			stop_reason: stop,
			usage: {...usage, output_tokens: 10},
		},
		/** The same message as the API streams it. */
		events: [
			{type: "message_start", message: {...message, content: [], stop_reason: null, usage}},
			{type: "content_block_start", index: 0, content_block: start},
			{type: "content_block_delta", index: 0, delta},
			{type: "content_block_stop", index: 0},
			{
				type: "message_delta",
				delta: {stop_reason: stop, stop_sequence: null},
				usage: {output_tokens: 10},
			},
			{type: "message_stop"},
		],
	};
};

const textOf = (content: unknown): string =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content
					.map((c) => (typeof c === "object" && c !== null && "text" in c ? String(c.text) : ""))
					.join("")
			: "";

/** Start the stand-in. `key` is the fake key; `stepsAt` gives the tool calls, in order, from its port. */
export const startStandIn = (
	key: string,
	stepsAt: (port: number) => readonly Step[],
): Promise<StandIn> => {
	const arrived: Arrived[] = [];
	const results = new Map<number, {text: string; error: boolean}>();
	let steps: readonly Step[] = [];

	const handle = (req: IncomingMessage, res: ServerResponse) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf8");
			const auth = req.headers.authorization;
			const keyed = auth === `Bearer ${key}`;
			const stray = req.headers["x-api-key"] !== undefined || (auth !== undefined && !keyed);
			const path = new URL(req.url ?? "/", "http://standin").pathname;
			let body: {
				model?: string;
				stream?: boolean;
				tools?: {name?: string}[];
				messages?: {role: string; content: unknown}[];
			} = {};
			try {
				body = JSON.parse(raw);
			} catch {
				// Not JSON: answered below as any other request.
			}
			const main = (body.tools ?? []).some((t) => t.name === "Bash");
			const messages = body.messages ?? [];
			const step = main ? messages.filter((m) => m.role === "assistant").length : null;
			arrived.push({path, keyed, stray, step, keyInBody: raw.includes(key)});
			if (!keyed) {
				res.writeHead(401, {"content-type": "application/json"});
				res.end(
					JSON.stringify({
						type: "error",
						error: {type: "authentication_error", message: "stand-in: no key"},
					}),
				);
				return;
			}
			// What the last step's tool call sent back, as Claude Code passed it on.
			if (step !== null && step > 0) {
				const last = messages.at(-1);
				if (last !== undefined && Array.isArray(last.content))
					for (const b of last.content)
						if (
							typeof b === "object" &&
							b !== null &&
							(b as {type?: string}).type === "tool_result"
						) {
							const r = b as {content?: unknown; is_error?: boolean};
							results.set(step - 1, {text: textOf(r.content), error: r.is_error === true});
						}
			}
			const model = body.model ?? "claude-haiku-4-5";
			const next = step === null ? undefined : steps[step];
			const reply =
				next !== undefined
					? answer(model, {kind: "tool", step: next})
					: answer(model, {kind: "text", text: step === null ? "ok" : "done"});
			if (body.stream === true) return sse(res, reply.events);
			res.writeHead(200, {"content-type": "application/json", "request-id": "req_standin"});
			res.end(JSON.stringify(reply.whole));
		});
	};

	const server = createServer(handle);
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as AddressInfo).port;
			steps = stepsAt(port);
			resolve({
				port,
				arrived,
				results,
				close: () =>
					new Promise((r) => {
						server.closeAllConnections();
						server.close(() => r());
					}),
			});
		}),
	);
};
