// One client shape for both backends, so the laws run unchanged against the Durable Object
// (over HTTP) and against node:sqlite (`node-ledger.ts`).
import type {AppendResult, ClaimResult, Event, RenewResult, Row} from "./sql.ts";

export type Exec = {ok: true; rows: Row[]} | {ok: false; error: string};

export interface LedgerClient {
	append(
		stream: string,
		expectedRev: number,
		event: Event,
		fence?: number | null,
	): Promise<AppendResult>;
	claim(stream: string, holder: string, expectedRev: number, ttlMs: number): Promise<ClaimResult>;
	renew(stream: string, fence: number, ttlMs: number): Promise<RenewResult>;
	cancel(stream: string, writer: string): Promise<AppendResult>;
	read(fromPos: number, limit: number): Promise<Row[]>;
	readStream(stream: string): Promise<Row[]>;
	lease(stream: string): Promise<Row | null>;
	openCriteria(stream: string): Promise<Row[]>;
	tryExec(sql: string): Promise<Exec>;
}

/** Sends one call; returns the parsed JSON body. Throws on a network error or a 500. */
export type Post = (
	path: string,
	body: string,
) => Promise<{status: number; json(): Promise<unknown>}>;

export class CallError extends Error {}

/** A client over the Ledger's HTTP face: POST /<ledger>/<method> with the args as a JSON array. */
export const httpClient = (post: Post, ledger: string): LedgerClient => {
	const call = async <T>(method: string, ...args: unknown[]): Promise<T> => {
		const res = await post(`/${ledger}/${method}`, JSON.stringify(args));
		const body = await res.json();
		if (res.status !== 200) throw new CallError(`${method}: ${res.status} ${JSON.stringify(body)}`);
		return body as T;
	};
	return {
		append: (stream, expectedRev, event, fence) =>
			call("append", stream, expectedRev, event, fence ?? null),
		claim: (stream, holder, expectedRev, ttlMs) =>
			call("claim", stream, holder, expectedRev, ttlMs),
		renew: (stream, fence, ttlMs) => call("renew", stream, fence, ttlMs),
		cancel: (stream, writer) => call("cancel", stream, writer),
		read: (fromPos, limit) => call("read", fromPos, limit),
		readStream: (stream) => call("readStream", stream),
		lease: (stream) => call("lease", stream),
		openCriteria: (stream) => call("openCriteria", stream),
		tryExec: (sql) => call("tryExec", sql),
	};
};

/** A `Post` over plain fetch to a running Miniflare (a child host, or another process's). */
export const fetchPost =
	(base: string): Post =>
	(path, body) =>
		fetch(`${base}${path}`, {method: "POST", body, headers: {"content-type": "application/json"}});
