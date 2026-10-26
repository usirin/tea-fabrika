import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {Agent, request} from "node:http";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {Effect, Redacted} from "effect";
import * as fc from "fast-check";
import {Miniflare} from "miniflare";
import {afterAll, describe, expect, it} from "vitest";
import {doorOf} from "./http.ts";
import {layerSignerKey} from "./signer.ts";
import {keyLineOf} from "./sshsig.ts";
import * as realOptions from "./worker-options.ts";

// The door's wire law, on fast-check, in workerd under Miniflare: after any refusal, the next call
// on the same kept-alive connection gets an answer. workerd drops a connection whose answer left
// the request's body unread, and then the client's next call on it fails (experiment 145). GitHub
// is a fake, reached through Miniflare's `outboundService`; nothing leaves this machine.
//
// Nobody writes their own exam: this file writes the law and never the ledger's code. Each planted
// mistake is a text edit on a COPY of durable-object.ts, bundled from a temp folder by a copy of
// worker-options.ts, so the real code is untouched. The laws of the door itself are in
// door.laws.test.ts.

// ---------------------------------------------------------------- the module under test

type Options = typeof realOptions;

const madeDirs: string[] = [];
afterAll(() => {
	for (const d of madeDirs) rmSync(d, {recursive: true, force: true});
});

/** What the Worker is bundled from: worker-options.ts bundles durable-object.ts and its imports. */
const FILES = [
	"worker-options",
	"beside",
	"durable-object",
	"door",
	"keys",
	"keys-github",
	"rules",
	"sshsig",
] as const;

/** A copy of the Worker's files with one mistake in durable-object.ts, imported from its own folder. */
async function plant(from: string, to: string): Promise<Options> {
	const dir = mkdtempSync(join(import.meta.dirname, ".door-wire-laws-plant-"));
	madeDirs.push(dir);
	for (const f of FILES) {
		let text = readFileSync(join(import.meta.dirname, `${f}.ts`), "utf8");
		if (f === "durable-object") {
			const count = text.split(from).length - 1;
			if (count !== 1) throw new Error(`plant edit: "${from}" found ${count} times, want 1`);
			text = text.replace(from, () => to);
		}
		writeFileSync(join(dir, `${f}.ts`), text);
	}
	return (await import(
		/* @vite-ignore */ pathToFileURL(join(dir, "worker-options.ts")).href
	)) as Options;
}

// ---------------------------------------------------------------- the harness

const LEDGER = "demo";

/** A fake api.github.com that knows alice, github:7, with one key. */
const fakeGitHub = (alice: string) => async (req: Request) => {
	const url = new URL(req.url);
	if (url.pathname === "/user/7") return Response.json({id: 7, login: "alice"});
	if (url.pathname === "/users/alice/keys") return Response.json([{id: 1, key: alice}]);
	return Response.json({message: "Not Found"}, {status: 404});
};

/** A shared ledger in workerd, from `options`, with alice signed in as its founder. */
const ledgerOf = async (options: Options) => {
	const pair = (await crypto.subtle.generateKey({name: "Ed25519"}, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const line = keyLineOf(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
	const mf = new Miniflare(
		options.ledgerOptions({
			persist: false,
			direct: 0,
			door: {
				kind: "shared",
				founder: "github:7",
				keys: {kind: "github", cacheMs: 0, failMs: 0, api: fakeGitHub(line)},
			},
		}),
	);
	await mf.ready;
	const url = (await mf.unsafeGetDirectURL()).origin;
	const s = await Effect.runPromise(
		doorOf({url, ledger: LEDGER})
			.login("alice")
			.pipe(Effect.provide(layerSignerKey(pair))),
	);
	return {mf, url, token: Redacted.value(s.token)};
};

type Call = {
	readonly method: string;
	readonly path: string;
	readonly body: string;
	readonly token?: string;
};

/**
 * Calls on one kept-alive connection, in turn: each call's status (0: the connection broke), and
 * whether it went on the connection the one before it opened. Node's own `http`, held to one socket.
 */
const onOneConnection = async (url: string, calls: readonly Call[]) => {
	const agent = new Agent({keepAlive: true, maxSockets: 1});
	try {
		const answers: {status: number; reused: boolean}[] = [];
		for (const c of calls)
			answers.push(
				await new Promise((resolve) => {
					const req = request(
						`${url}${c.path}`,
						{
							method: c.method,
							agent,
							headers: {
								"content-type": "application/json",
								// Said outright: Node frames no body of a GET or a DELETE on its own, and its bytes
								// would read as the next request.
								"content-length": String(new TextEncoder().encode(c.body).length),
								...(c.token === undefined ? {} : {authorization: `Bearer ${c.token}`}),
							},
						},
						(res) => {
							res.resume();
							res.on("end", () => resolve({status: res.statusCode ?? 0, reused: req.reusedSocket}));
						},
					);
					req.on("error", () => resolve({status: 0, reused: req.reusedSocket}));
					req.end(c.body);
				}),
			);
		return answers;
	} finally {
		agent.destroy();
	}
};

// ---------------------------------------------------------------- random refusals

/** One request the ledger refuses: what is wrong with it. */
type Bad =
	| {readonly type: "worker404"; readonly path: string}
	| {readonly type: "noCredential"; readonly method: string}
	| {readonly type: "wrongSession"; readonly guess: string}
	| {readonly type: "badTail"; readonly stream: string}
	| {readonly type: "unknownDoorStep"; readonly step: string}
	| {readonly type: "badArgs"; readonly method: string}
	| {readonly type: "wrongVerb"; readonly verb: "GET" | "PUT" | "DELETE"}
	| {readonly type: "badLogin"; readonly step: "login" | "agent-login"};

const word = fc.stringMatching(/^[a-z][a-z-]{0,9}$/);
const wire = fc.constantFrom("read", "register", "append", "claim", "readStream", "lease");
const arbBad: fc.Arbitrary<Bad> = fc.oneof(
	fc.record({type: fc.constant("worker404" as const), path: fc.constantFrom("/", "//x", "/?a=1")}),
	fc.record({type: fc.constant("noCredential" as const), method: fc.oneof(wire, word)}),
	fc.record({type: fc.constant("wrongSession" as const), guess: word}),
	fc.record({type: fc.constant("badTail" as const), stream: word}),
	fc.record({
		type: fc.constant("unknownDoorStep" as const),
		step: word.filter(
			(s) =>
				![
					"challenge",
					"login",
					"agent-login",
					"who",
					"members",
					"invite",
					"remove",
					"agent",
				].includes(s),
		),
	}),
	fc.record({type: fc.constant("badArgs" as const), method: fc.oneof(wire, word)}),
	fc.record({
		type: fc.constant("wrongVerb" as const),
		verb: fc.constantFrom("GET" as const, "PUT" as const, "DELETE" as const),
	}),
	fc.record({
		type: fc.constant("badLogin" as const),
		step: fc.constantFrom("login" as const, "agent-login" as const),
	}),
);
/** A body as anyone may send one: small or big, JSON or not. Made from this at the call. */
const arbBody = fc.record({
	size: fc.constantFrom(0, 100, 64 * 1024, 256 * 1024, 1024 * 1024),
	json: fc.boolean(),
});
type Body = typeof arbBody extends fc.Arbitrary<infer T> ? T : never;
const bodyOf = (b: Body): string =>
	b.json ? JSON.stringify([0, 10, "x".repeat(b.size)]) : "y".repeat(b.size);

/** The call a refusal is, with the signed-in person's token where the refusal needs one. */
const callOf = (bad: Bad, body: string, token: string): Call => {
	const post = (path: string, t?: string): Call =>
		t === undefined ? {method: "POST", path, body} : {method: "POST", path, body, token: t};
	switch (bad.type) {
		case "worker404":
			return post(bad.path);
		case "noCredential":
			return post(`/${LEDGER}/${bad.method}`);
		case "wrongSession":
			return post(`/${LEDGER}/read`, `fabrika_p_${bad.guess}`);
		case "badTail":
			return post(`/${LEDGER}/tail?stream=${bad.stream}`, token);
		case "unknownDoorStep":
			return post(`/${LEDGER}/door/${bad.step}`, token);
		case "badArgs":
			// Not the arguments a method takes: a body that is no JSON array, or the wrong count.
			return post(`/${LEDGER}/${bad.method}`, token);
		case "wrongVerb":
			return {method: bad.verb, path: `/${LEDGER}/read`, body, token};
		case "badLogin":
			return post(`/${LEDGER}/door/${bad.step}`);
	}
};

const GOOD = (token: string): Call => ({
	method: "POST",
	path: `/${LEDGER}/read`,
	body: JSON.stringify([0, 1, null]),
	token,
});

const ensure = (cond: boolean, msg: string): void => {
	if (!cond) throw new Error(msg);
};

/**
 * The law: after any refusal (the Worker's 404, no credential, a wrong session, a bad tail request,
 * an unknown door step, bad arguments, a wrong verb, a bad login), the next call on the same
 * connection gets an answer, on that connection. Runs of one to three refusals, then a good read.
 */
const nextCallAnswered = async (options: Options): Promise<void> => {
	const L = await ledgerOf(options);
	try {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.tuple(arbBad, arbBody), {minLength: 1, maxLength: 3}),
				async (bads) => {
					const calls = [
						...bads.map(([b, body]) => callOf(b, bodyOf(body), L.token)),
						GOOD(L.token),
					];
					const answers = await onOneConnection(L.url, calls);
					const shown = `${JSON.stringify(bads)} answered ${JSON.stringify(answers)}`;
					for (const [i, a] of answers.entries()) {
						const last = i === answers.length - 1;
						ensure(a.status !== 0, `call ${i} got no answer: ${shown}`);
						ensure(i === 0 || a.reused, `call ${i} did not go on the same connection: ${shown}`);
						ensure(
							last ? a.status === 200 : a.status >= 400,
							`call ${i} answered ${a.status}: ${shown}`,
						);
					}
				},
			),
			{numRuns: 60, seed: 7, endOnFailure: true},
		);
	} finally {
		await L.mf.dispose();
	}
};

/** Each plant edits a copy of durable-object.ts. None touches the real code. */
const PLANTS: Record<string, () => Promise<Options>> = {
	// The Durable Object answers without reading the rest of the body.
	objectKeepsBody: () =>
		plant("return drained(req, await this.through(req));", "return this.through(req);"),
	// The Worker's own 404 answers without reading the body.
	workerKeepsBody: () =>
		plant(
			'if (name === null) return drained(req, new Response("not found", {status: 404}));',
			'if (name === null) return new Response("not found", {status: 404});',
		),
};

describe("the door's wire law", () => {
	it("after any refusal, the next call on the same connection gets an answer", async () => {
		await nextCallAnswered(realOptions);
	}, 120_000);

	it("the law is seen to fail on each planted mistake", async () => {
		// "caught" only when the law itself failed on a call after a refusal; a crash is not caught.
		const caught: Record<string, string> = {};
		for (const [name, make] of Object.entries(PLANTS))
			caught[name] = await nextCallAnswered(await make()).then(
				() => "held",
				(e: unknown) => {
					const why = String((e as Error).cause ?? e);
					return /call [1-9][0-9]* (got no answer|did not go on the same connection)/.test(why)
						? "caught"
						: why;
				},
			);
		expect(caught).toEqual({objectKeepsBody: "caught", workerKeepsBody: "caught"});
	}, 240_000);
});
