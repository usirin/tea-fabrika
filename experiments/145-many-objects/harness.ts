// Starting a server for a test or the script: Miniflare in this process, on a free port, its data
// in a temp folder or in memory. And the people the tests use, by GitHub id. No real account: the
// ids are made up, and the sessions are minted here with the server's own secret.
//
// Node at the edge: a temp folder, and random bytes for the secret.
import {randomBytes} from "node:crypto";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Schema} from "effect";
import {Miniflare} from "miniflare";
import type {Server} from "./client.ts";
import {serverOptions} from "./options.ts";
import {mint, type Who} from "./session.ts";

/** The operator: runs the server, creates projects, moves the server. A member of nothing. */
export const OPERATOR = "github:9000";
/** Person A, person B, person C and person D. */
export const A = "github:1001";
export const B = "github:1002";
export const C = "github:1003";
export const D = "github:1004";

export const user = (id: string): Who => ({kind: "user", id});
/** An agent working for `person`: its id starts with the person's. */
export const agent = (person: string, name: string): Who => ({
	kind: "agent",
	id: `${person}.${name}`,
	for: person,
});
/** The object of a person: `person/<the number>`. */
export const personObject = (id: string) => `person/${id.replace(/^github:/, "")}`;

export interface Running {
	readonly url: string;
	readonly secret: string;
	/** The data folder, or null: in memory. */
	readonly dir: string | null;
	readonly mf: Miniflare;
	/** The server, as `who` sees it: its origin and a session for `who`. */
	readonly as: (who: Who, ttlMs?: number) => Promise<Server>;
	/** Stop workerd, and keep the folder (`stop`) or remove it too (`drop`). */
	readonly stop: () => Promise<void>;
	readonly drop: () => Promise<void>;
}

/** Web Crypto refused to sign a session. */
export class MintFailed extends Schema.TaggedError<MintFailed>()("MintFailed", {
	message: Schema.String,
}) {}

/** `mint`, for code written in Effect: a refusal is a typed error, not a defect. */
export const minted = (secret: string, who: Who, ttlMs: number, now = Date.now()) =>
	Effect.tryPromise({
		try: () => mint(secret, who, ttlMs, now),
		catch: (cause) => new MintFailed({message: String(cause)}),
	});

/** `s.as(who)`, for code written in Effect. */
export const sessionOf = (s: Running, who: Who) =>
	Effect.tryPromise({
		try: () => s.as(who),
		catch: (cause) => new MintFailed({message: String(cause)}),
	});

export interface Start {
	readonly planted?: string;
	/** `true`: a new temp folder. A string: that folder (a restart keeps the data). Default memory. */
	readonly persist?: boolean | string;
	readonly secret?: string;
	/** workerd's port. Default a free one; a restart on the same port keeps the same URL. */
	readonly port?: number;
}

export const startServer = async (o: Start = {}): Promise<Running> => {
	const dir =
		typeof o.persist === "string"
			? o.persist
			: o.persist === true
				? mkdtempSync(join(tmpdir(), "exp145-"))
				: null;
	const secret = o.secret ?? randomBytes(32).toString("hex");
	const mf = new Miniflare(
		serverOptions({
			persist: dir ?? false,
			secret,
			operator: OPERATOR,
			port: o.port ?? 0,
			...(o.planted === undefined ? {} : {planted: o.planted}),
		}),
	);
	await mf.ready;
	const url = (await mf.unsafeGetDirectURL()).origin;
	const stop = () => mf.dispose();
	return {
		url,
		secret,
		dir,
		mf,
		as: async (who, ttlMs = 600_000) => ({url, token: await mint(secret, who, ttlMs)}),
		stop,
		drop: async () => {
			await stop();
			if (dir !== null) rmSync(dir, {recursive: true, force: true});
		},
	};
};
