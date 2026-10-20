// The few names of the Workers runtime the Durable Object uses: workerd gives them, and this repo
// has no `@cloudflare/workers-types`. Only what `durable-object.ts` touches is declared.

declare module "cloudflare:workers" {
	export class DurableObject {
		constructor(ctx: unknown, env: unknown);
	}
}

interface WorkerSocket {
	send(text: string): void;
	close(code?: number, reason?: string): void;
}

declare class WebSocketPair {
	0: WorkerSocket;
	1: WorkerSocket;
}

interface ResponseInit {
	/** workerd: the client end of a `WebSocketPair`, on a 101 answer. */
	webSocket?: WorkerSocket;
}
