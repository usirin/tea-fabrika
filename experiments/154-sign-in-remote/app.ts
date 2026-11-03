// Experiment 154's person's app: the part on the person's own laptop. It reads its inbox on the
// ledger, catches the sign-in's loopback callback (RFC 8252 section 7.3) on 127.0.0.1, and sends
// back only {state, code, client}. It never sees a verifier or a token: it has none to see.
//
//   sign_in_wanted {box}       open a catcher on 1455, or on a free port if 1455 is taken (the
//                              Codex CLI's login port too); tell the box the port
//   sign_in_url {box, url}     check the URL is the sign-in page, for our catcher, then open it
//   callback ?code&state       check the state is the one in the URL we opened; send the code
//   callback ?error&state      send {denied}
//   paste <url>                the same check for a callback URL pasted by hand (from a phone)
//
// Node at the edge, said here: node:http for the catcher, which must bind one exact loopback port
// and tell "taken" apart; Effect's HTTP server picks neither.
import {createServer, type Server} from "node:http";
import {Ledger, streams} from "@kampus/fabrika-old";
import {Duration, Effect, Schema} from "effect";
import {boxName, personName, redirectOf, SIWC, type ToBox, ToPerson} from "./wire.ts";

export interface AppOptions {
	readonly who: string;
	/** The sign-in page the app agrees to open: its origin and path, nothing else. */
	readonly authorize: string;
	/** Opens a URL: a browser on the laptop, or the fake person in a test. */
	readonly open: (url: string) => Promise<void>;
	/** The port to try first. 1455, unless a test says otherwise. */
	readonly port?: number;
	readonly say: (event: Record<string, unknown>) => void;
}

interface Catcher {
	readonly server: Server;
	readonly port: number;
	state: string | null;
}

const WRITER = "user:person";

/** Listen on 127.0.0.1:`port`; `null` if it is taken. */
const listen = (server: Server, port: number) =>
	new Promise<number | null>((resolve, reject) => {
		const onError = (e: NodeJS.ErrnoException) =>
			e.code === "EADDRINUSE" ? resolve(null) : reject(e);
		server.once("error", onError);
		server.listen(port, "127.0.0.1", () => {
			server.removeListener("error", onError);
			const a = server.address();
			resolve(typeof a === "object" && a !== null ? a.port : null);
		});
	});

/** Bind `first`, or any free loopback port if it is taken (only the port may vary, says OpenAI). */
export const bindLoopback = async (
	server: Server,
	first: number,
	say: (event: Record<string, unknown>) => void,
): Promise<number> => {
	const port = await listen(server, first);
	if (port !== null) return port;
	say({ev: "port_taken", port: first});
	const other = await listen(server, 0);
	if (other === null) throw new Error("no loopback port");
	return other;
};

/** What a callback URL says, checked against the state we wait for. */
export const readCallback = (
	url: URL,
	port: number,
	state: string | null,
): {readonly ok: ToBox} | {readonly refused: string} => {
	const expected = new URL(redirectOf(port));
	if (url.origin !== expected.origin || url.pathname !== expected.pathname)
		return {refused: "not our callback"};
	const got = url.searchParams.get("state");
	if (state === null || got !== state) return {refused: "state mismatch"};
	const error = url.searchParams.get("error");
	if (error !== null) return {ok: {kind: "denied", state: got, error}};
	const code = url.searchParams.get("code");
	if (code === null) return {refused: "no code"};
	return {ok: {kind: "code", state: got, code, client: url.searchParams.get("client_id")}};
};

/** Is `url` the sign-in page, made for this catcher? Then its state. */
export const readSignInUrl = (raw: string, authorize: string, port: number): string | null => {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	const page = new URL(authorize);
	if (url.origin !== page.origin || url.pathname !== page.pathname) return null;
	if (url.searchParams.get("redirect_uri") !== redirectOf(port)) return null;
	if (url.searchParams.get("code_challenge_method") !== "S256") return null;
	if (!(url.searchParams.get("scope") ?? "").split(" ").includes(SIWC.planScope)) return null;
	return url.searchParams.get("state");
};

const toPersonOf = Schema.decodeUnknownExit(Schema.fromJsonString(ToPerson));

/** The app, until `stop` is called. Answers its handle: the paste path and what it saw. */
export const runApp = (o: AppOptions) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		yield* ledger.register(personName(o.who), WRITER);
		const catchers = new Map<string, Catcher>();
		const seen: ToPerson[] = [];
		const toBox = (box: string, row: ToBox, id: string) =>
			Effect.runPromise(
				ledger
					.send(streams(boxName(box)).inbox, id, {kind: row.kind, writer: WRITER, data: row})
					.pipe(Effect.provideService(Ledger, ledger), Effect.ignore),
			);

		const closeCatcher = (box: string) => {
			const c = catchers.get(box);
			if (c === undefined) return;
			catchers.delete(box);
			c.server.close();
			// Spare connections a browser opened ahead would otherwise carry a later login's callback.
			c.server.closeAllConnections();
		};

		// One more each time a box asks again (way b): each round's rows need their own ids.
		const rounds = new Map<string, number>();
		const roundOf = (box: string) => rounds.get(box) ?? 0;

		const caught = async (box: string, row: ToBox) => {
			await toBox(box, row, `${box}/${row.kind}/${roundOf(box)}`);
			o.say({ev: row.kind === "code" ? "code_sent" : "denied_sent", box});
			closeCatcher(box);
		};

		const openCatcher = async (box: string) => {
			if (catchers.has(box)) return;
			if (seen.filter((r) => r.kind === "sign_in_wanted" && r.box === box).length > 1)
				rounds.set(box, roundOf(box) + 1);
			const server = createServer((req, res) => {
				const c = catchers.get(box);
				const read =
					c === undefined
						? {refused: "closed"}
						: readCallback(new URL(req.url ?? "/", redirectOf(c.port)), c.port, c.state);
				if ("refused" in read) {
					o.say({ev: "callback_refused", box, why: read.refused});
					res.writeHead(400, {"content-type": "text/plain"});
					res.end("fabrika: this sign-in was not asked for here.");
					return;
				}
				res.writeHead(200, {"content-type": "text/plain"});
				res.end("fabrika: signed in. You can close this window.");
				void caught(box, read.ok);
			});
			const port = await bindLoopback(server, o.port ?? SIWC.port, o.say);
			catchers.set(box, {server, port, state: null});
			await toBox(box, {kind: "catcher", port}, `${box}/catcher/${roundOf(box)}`);
			o.say({ev: "catcher", box, port, round: roundOf(box)});
		};

		const onRow = async (row: ToPerson) => {
			seen.push(row);
			switch (row.kind) {
				case "sign_in_wanted":
					return openCatcher(row.box);
				case "sign_in_url": {
					const c = catchers.get(row.box);
					const state = c === undefined ? null : readSignInUrl(row.url, o.authorize, c.port);
					if (c === undefined || state === null) {
						o.say({ev: "url_refused", box: row.box});
						return;
					}
					c.state = state;
					o.say({ev: "opened", box: row.box});
					return o.open(row.url);
				}
				case "signed_in":
					o.say({ev: "signed_in", box: row.box, scopes: row.scopes, expires_in: row.expires_in});
					return;
				case "sign_in_ended":
					closeCatcher(row.box);
					o.say({ev: "box_ended", box: row.box, why: row.why, revoked: row.revoked});
					return;
			}
		};

		let rev = 0;
		const inbox = streams(personName(o.who)).inbox;
		const poll = Effect.gen(function* () {
			for (;;) {
				const rows = yield* ledger.readStream(inbox, rev, 100).pipe(Effect.orElseSucceed(() => []));
				for (const r of rows) {
					rev = r.rev;
					const read = toPersonOf(r.data);
					if (read._tag === "Success") yield* Effect.promise(() => onRow(read.value));
				}
				yield* Effect.sleep(Duration.millis(100));
			}
		});
		const fiber = yield* Effect.forkScoped(poll);
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				for (const box of [...catchers.keys()]) closeCatcher(box);
			}),
		);
		return {
			fiber,
			seen,
			catchers,
			/** The pasted-redirect path: a callback URL copied from another device's address bar. */
			paste: (box: string, raw: string) => {
				const c = catchers.get(box);
				if (c === undefined) return Promise.resolve("no sign-in open");
				const read = readCallback(new URL(raw), c.port, c.state);
				if ("refused" in read) return Promise.resolve(read.refused);
				return caught(box, read.ok).then(() => "sent");
			},
		};
	});

/** The fake person: follows the sign-in page's redirect to the catcher, as a browser would. */
export const fakeBrowser = async (url: string) => {
	const page = await fetch(url, {redirect: "manual"});
	const next = page.headers.get("location");
	if (next === null) return;
	await fetch(next).then((r) => r.text());
};

/** A fake person on a phone: reads where the sign-in page sends them, and does not follow it. */
export const phoneBrowser = (keep: (callback: string) => void) => async (url: string) => {
	const page = await fetch(url, {redirect: "manual"});
	const next = page.headers.get("location");
	if (next !== null) keep(next);
};
