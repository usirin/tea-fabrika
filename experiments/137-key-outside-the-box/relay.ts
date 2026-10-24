// Experiment 137, the relay: the one way a box's model calls leave it.
//
// It runs on the host, outside every box. It takes a request from the box, drops every header that
// could carry a credential, adds its own, and sends the request to one fixed upstream. It forwards
// one path only, `POST /v1/messages`, for the models it is told, and refuses everything else.
// One relay listens for one box, so what it counts is that box's, and the box cannot change it.
//
// The credential lives in this process's memory only: it is never in an environment variable,
// on a command line, in a file the relay writes, or in anything sent back to the box.
//
// Node at the edge: the relay is an HTTP server and an HTTP client.

import {
	createServer,
	request as httpRequest,
	type IncomingHttpHeaders,
	type IncomingMessage,
	type OutgoingHttpHeaders,
	type ServerResponse,
} from "node:http";
import {request as httpsRequest} from "node:https";
import type {AddressInfo, Socket} from "node:net";

/** Where the box reaches the relay: a port on the host's loopback, or a unix socket. */
export type Listen = {readonly kind: "port"} | {readonly kind: "socket"; readonly path: string};

export interface RelayConfig {
	readonly listen: Listen;
	/** The one place requests go, an origin: `https://api.anthropic.com`, or the stand-in. */
	readonly upstream: string;
	/** The headers that carry the credential, given the betas the box asked for. */
	readonly credential: (betas: readonly string[]) => Readonly<Record<string, string>>;
	/** The models a box may ask for. */
	readonly models: readonly string[];
	readonly cap: {
		/** Requests forwarded for this box, in all. */
		readonly requests: number;
		/** Tokens in and out for this box, in all, as the upstream counted them. */
		readonly tokens: number;
		/** The largest `max_tokens` one request may ask for. */
		readonly maxTokens: number;
	};
}

/** One request as the relay saw it. Header names only, never a value. */
export interface Seen {
	readonly method: string;
	readonly target: string;
	readonly model: string | null;
	readonly sent: boolean;
	readonly why: string | null;
	readonly status: number;
	/** Names of the credential headers the box sent. All of them were dropped. */
	readonly boxCredentials: readonly string[];
	readonly betas: readonly string[];
	readonly tokensIn: number;
	readonly tokensOut: number;
}

export interface Relay {
	readonly where:
		| {readonly kind: "port"; readonly port: number}
		| {readonly kind: "socket"; readonly path: string};
	readonly seen: readonly Seen[];
	readonly spent: () => {readonly requests: number; readonly tokens: number};
	readonly close: () => Promise<void>;
}

/** Headers that may carry a credential. None of them is ever passed on from the box. */
const CREDENTIALS = ["authorization", "x-api-key", "cookie", "proxy-authorization"];

/** The request headers passed on, besides the credential the relay adds. */
const PASS = new Set([
	"content-type",
	"accept",
	"anthropic-version",
	"anthropic-beta",
	"user-agent",
	"x-app",
]);
const passed = (name: string) => PASS.has(name) || name.startsWith("x-stainless-");

/** The response headers passed back. */
const BACK = new Set(["content-type", "request-id", "retry-after"]);

const MAX_BODY = 8 * 1024 * 1024;

const betasOf = (headers: IncomingHttpHeaders): readonly string[] =>
	String(headers["anthropic-beta"] ?? "")
		.split(",")
		.map((b) => b.trim())
		.filter(Boolean);

const refuse = (res: ServerResponse, status: number, why: string) => {
	res.writeHead(status, {"content-type": "application/json"});
	res.end(
		JSON.stringify({type: "error", error: {type: "permission_error", message: `relay: ${why}`}}),
	);
};

/** The tokens one answer used, read from its stream or its JSON. */
const usageOf = (contentType: string, body: string) => {
	let tokensIn = 0;
	let tokensOut = 0;
	const add = (u: Record<string, unknown> | undefined, out: boolean) => {
		if (u === undefined) return;
		const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
		const input =
			n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
		if (input > 0) tokensIn = input;
		if (out || n("output_tokens") > 0) tokensOut = Math.max(tokensOut, n("output_tokens"));
	};
	try {
		if (contentType.includes("text/event-stream")) {
			for (const line of body.split("\n")) {
				if (!line.startsWith("data: ")) continue;
				const event = JSON.parse(line.slice(6));
				if (event.type === "message_start") add(event.message?.usage, false);
				if (event.type === "message_delta") add(event.usage, true);
			}
		} else add(JSON.parse(body).usage, true);
	} catch {
		// Not the shape of an answer: nothing counted from it.
	}
	return {tokensIn, tokensOut};
};

/** Start a relay for one box. */
export const startRelay = (config: RelayConfig): Promise<Relay> => {
	const seen: Seen[] = [];
	let requests = 0;
	let tokens = 0;
	const upstream = new URL(config.upstream);
	const send = upstream.protocol === "https:" ? httpsRequest : httpRequest;

	const handle = (req: IncomingMessage, res: ServerResponse) => {
		const target = req.url ?? "";
		const boxCredentials = CREDENTIALS.filter((h) => req.headers[h] !== undefined);
		const betas = betasOf(req.headers);
		const note = (s: Omit<Seen, "method" | "target" | "boxCredentials" | "betas">) =>
			seen.push({
				method: req.method ?? "",
				target: target.slice(0, 80),
				boxCredentials,
				betas,
				...s,
			});
		const no = (status: number, why: string, model: string | null = null) => {
			note({model, sent: false, why, status, tokensIn: 0, tokensOut: 0});
			refuse(res, status, why);
		};
		// Origin form only: a target that names a host (a proxy's request) is refused.
		if (!target.startsWith("/")) return no(403, "only a path, never a host");
		const url = new URL(target, "http://relay");
		if (req.method !== "POST" || url.pathname !== "/v1/messages")
			return no(403, `${req.method} ${url.pathname} is not forwarded`);
		if (![...url.searchParams.keys()].every((k) => k === "beta"))
			return no(403, "an unknown query");
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size <= MAX_BODY) chunks.push(c);
		});
		req.on("end", () => {
			if (size > MAX_BODY) return no(413, "body too large");
			const body = Buffer.concat(chunks);
			let model: string | null = null;
			let maxTokens = 0;
			try {
				const parsed = JSON.parse(body.toString("utf8"));
				model = typeof parsed.model === "string" ? parsed.model : null;
				maxTokens = typeof parsed.max_tokens === "number" ? parsed.max_tokens : 0;
			} catch {
				return no(400, "body is not JSON");
			}
			if (model === null || !config.models.includes(model))
				return no(403, `model ${String(model)} is not allowed`, model);
			if (maxTokens > config.cap.maxTokens)
				return no(403, `max_tokens ${maxTokens} is over ${config.cap.maxTokens}`, model);
			if (requests >= config.cap.requests || tokens >= config.cap.tokens)
				return no(403, "this box's cap is reached", model);
			requests++;
			const headers: OutgoingHttpHeaders = {};
			for (const [name, value] of Object.entries(req.headers))
				if (value !== undefined && passed(name)) headers[name] = value;
			Object.assign(headers, config.credential(betas), {
				host: upstream.host,
				"accept-encoding": "identity",
				"content-length": String(body.length),
			});
			const out = send(
				{
					protocol: upstream.protocol,
					hostname: upstream.hostname,
					port: upstream.port === "" ? undefined : upstream.port,
					method: "POST",
					path: url.pathname + url.search,
					headers,
					timeout: 180_000,
				},
				(up) => {
					const back: OutgoingHttpHeaders = {};
					for (const [name, value] of Object.entries(up.headers))
						if (value !== undefined && BACK.has(name)) back[name] = value;
					res.writeHead(up.statusCode ?? 502, back);
					const answer: Buffer[] = [];
					up.on("data", (c: Buffer) => {
						answer.push(c);
						res.write(c);
					});
					up.on("end", () => {
						res.end();
						const used = usageOf(
							String(up.headers["content-type"] ?? ""),
							Buffer.concat(answer).toString("utf8"),
						);
						tokens += used.tokensIn + used.tokensOut;
						note({model, sent: true, why: null, status: up.statusCode ?? 0, ...used});
					});
				},
			);
			out.on("timeout", () => out.destroy(new Error("upstream timed out")));
			out.on("error", () => {
				note({model, sent: true, why: "upstream failed", status: 502, tokensIn: 0, tokensOut: 0});
				if (!res.headersSent) refuse(res, 502, "upstream failed");
				else res.end();
			});
			out.end(body);
		});
	};

	const server = createServer(handle);
	// A CONNECT asks the relay to open a tunnel somewhere: it never does.
	server.on("connect", (req: IncomingMessage, socket: Socket) => {
		seen.push({
			method: "CONNECT",
			target: (req.url ?? "").slice(0, 80),
			model: null,
			sent: false,
			why: "no tunnels",
			status: 403,
			boxCredentials: [],
			betas: [],
			tokensIn: 0,
			tokensOut: 0,
		});
		socket.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n");
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		const done = () => {
			const where =
				config.listen.kind === "socket"
					? {kind: "socket" as const, path: config.listen.path}
					: {kind: "port" as const, port: (server.address() as AddressInfo).port};
			resolve({
				where,
				seen,
				spent: () => ({requests, tokens}),
				close: () =>
					new Promise((r) => {
						server.closeAllConnections();
						server.close(() => r());
					}),
			});
		};
		if (config.listen.kind === "socket") server.listen(config.listen.path, done);
		else server.listen(0, "127.0.0.1", done);
	});
};
