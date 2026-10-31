// The few names of the Workers runtime the brain uses: workerd gives them, and this repo has no
// `@cloudflare/workers-types`. Only what `next/` touches is declared.

declare module "cloudflare:workers" {
	export class DurableObject<Env> {
		protected readonly ctx: ObjectContext;
		protected readonly env: Env;
		constructor(ctx: ObjectContext, env: Env);
	}
	export class WorkerEntrypoint<Env> {
		protected readonly env: Env;
	}
}

interface SqlCursor {
	toArray(): Record<string, unknown>[];
}

interface ObjectContext {
	readonly id: {readonly name?: string};
	readonly storage: {
		readonly sql: {exec(query: string, ...bindings: (string | number)[]): SqlCursor};
		readonly kv: {get(key: string): unknown; put(key: string, value: unknown): void};
	};
	acceptWebSocket(socket: BrainSocket): void;
	getWebSockets(): BrainSocket[];
	setWebSocketAutoResponse(pair: WebSocketRequestResponsePair): void;
}

/** The server end of a WebSocket, held by a Durable Object. */
interface BrainSocket {
	send(text: string): void;
	close(code?: number, reason?: string): void;
	serializeAttachment(value: unknown): void;
	deserializeAttachment(): unknown;
}

declare class WebSocketPair {
	0: BrainSocket;
	1: BrainSocket;
}

declare class WebSocketRequestResponsePair {
	constructor(request: string, response: string);
}

interface ResponseInit {
	/** workerd: the client end of a `WebSocketPair`, on a 101 answer. */
	webSocket?: BrainSocket;
}

/** One Durable Object class's names: `T` is what its stubs can be called with. */
interface ObjectSpace<T> {
	getByName(name: string): T;
}

/** Worker Loader: an isolate per id, made once from what `load` gives. */
interface WorkerLoader {
	get(
		id: string,
		load: () => Promise<{
			compatibilityDate: string;
			mainModule: string;
			modules: Record<string, string>;
			globalOutbound: null;
		}>,
	): {getEntrypoint<T>(name: string): T};
}
