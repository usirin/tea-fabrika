import {DurableObject} from "cloudflare:workers";
import {Option, Schema} from "effect";
import {answerHello, err, ok, readMessage} from "./wire.ts";

// One peer's one WebSocket (T2). It says hello, answers "ping" without running its code (T6), and
// passes each message on to the right object. Which object is `route`'s business: the transport
// knows no process and no ledger.
//
//   window --WebSocket--> gateway:w-1 --object call--> project, process:counter:1, ...
//   process:counter:1 --notify--> gateway:w-1 --WebSocket--> window

/** What others may call on a gateway: take a dial, or put text on the peer's pipe if it has one. */
export type GatewayCalls = {
	fetch(request: Request): Promise<Response>;
	notify(text: string): Promise<boolean>;
};

/** What a route answers: a value for the peer, or why it could not. */
export type Answer = {readonly ok: unknown} | {readonly why: string};

const Attachment = Schema.Struct({peer: Schema.String, hello: Schema.Boolean});
type Attachment = typeof Attachment.Type;

const attachmentFor = (socket: BrainSocket): Attachment =>
	Option.getOrElse(Schema.decodeUnknownOption(Attachment)(socket.deserializeAttachment()), () => ({
		peer: "unknown",
		hello: false,
	}));

/** A page may dial only the brain that served it (T3): a website gets no socket here. */
const sameOrigin = (request: Request): boolean => {
	const origin = request.headers.get("origin");
	const host = request.headers.get("host");
	if (origin === null || host === null) return false;
	return URL.canParse(origin) && new URL(origin).host === host;
};

export abstract class Gateway<Env> extends DurableObject<Env> implements GatewayCalls {
	constructor(ctx: ObjectContext, env: Env) {
		super(ctx, env);
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
	}

	/** Pass one asked message on to the object it is for. */
	protected abstract route(method: string, params: unknown, peer: string): Promise<Answer>;

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("upgrade") !== "websocket") {
			return new Response("a gateway takes WebSockets", {status: 426});
		}
		if (!sameOrigin(request)) return new Response("wrong origin", {status: 403});
		const peer = new URL(request.url).pathname.split("/")[2] ?? "unknown";
		// One peer, one pipe: a new dial replaces whatever it left behind.
		for (const old of this.ctx.getWebSockets()) old.close(4000, "replaced");
		const pair = new WebSocketPair();
		const server = pair[1];
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({peer, hello: false} satisfies Attachment);
		return new Response(null, {status: 101, webSocket: pair[0]});
	}

	async webSocketMessage(socket: BrainSocket, data: string | ArrayBuffer): Promise<void> {
		if (typeof data !== "string") return;
		const message = readMessage(data);
		if (Option.isNone(message) || message.value.is !== "ask") return;
		const {id, method, params} = message.value;
		const attached = attachmentFor(socket);
		if (method === "initialize") {
			const answer = answerHello(params);
			if ("why" in answer) {
				socket.send(err(id, answer.why));
				return;
			}
			socket.serializeAttachment({peer: attached.peer, hello: true} satisfies Attachment);
			socket.send(ok(id, answer));
			return;
		}
		if (!attached.hello) {
			socket.send(err(id, "no_hello"));
			return;
		}
		const answer = await this.route(method, params, attached.peer);
		socket.send("why" in answer ? err(id, answer.why) : ok(id, answer.ok));
	}

	webSocketClose(socket: BrainSocket): void {
		socket.close();
	}

	webSocketError(socket: BrainSocket): void {
		socket.close();
	}

	async notify(text: string): Promise<boolean> {
		const sockets = this.ctx.getWebSockets();
		for (const socket of sockets) socket.send(text);
		return sockets.length > 0;
	}
}
