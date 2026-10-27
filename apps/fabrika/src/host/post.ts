// `fabrika post`: an agent's write to the tracker on the home's shared ledger, as that agent, for
// the home's person. The door stamps it `agent:<name>` for that person, and an agent's session
// cannot answer an ask, so a post never approves anything (door.ts).
//
//   yield* post(home, "triage", [{kind: "comment", ticket: 9, body: "Plan ready."}])
//   // ["#9 open c28 The ledger moves to Cloudflare", ...]
//
// The agent's own key is <home>/agent_ed25519, made on first use. Each post signs a grant for it
// with the person's key, for an hour (signer.ts). The door lets an agent in only while its person
// has a session, so when it says no, the person logs in and the agent tries once more.
import {
	grant,
	isAgentName,
	keyFileText,
	layerSignerFile,
	memoryStorage,
	offer,
	Signer,
	start,
	viewOf,
} from "@kampus/fabrika";
import {DoorRefused, doorOf, layerHttp} from "@kampus/fabrika/http";
import {Author, type Do, pullRequestsOf, type Shown, tracker} from "@tea-fabrika/tracker";
import {Effect, FileSystem, Layer, Option, Path, Ref, Schema, Stream} from "effect";
import {ConnectFailed, connectionOf, loginWith} from "./connection.ts";

/** The agent's key file, in the home: one key for every agent of the home's person. */
export const AGENT_KEY = "agent_ed25519";

/** How long a post's grant lasts. A post takes seconds; the hour is room, not a session. */
const GRANT_MS = 60 * 60 * 1000;

/** A post the tracker refused, with why in words. */
export class PostFailed extends Schema.TaggedError<PostFailed>()("PostFailed", {
	why: Schema.String,
}) {}

/** The home's agent key file: made on first use (Ed25519, the person's alone), then kept. */
const agentKeyOf = (home: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const file = (yield* Path.Path).join(home, AGENT_KEY);
		if (yield* fs.exists(file)) return file;
		const text = yield* Effect.tryPromise({
			try: async () => {
				const pair = (await crypto.subtle.generateKey({name: "Ed25519"}, true, [
					"sign",
					"verify",
				])) as CryptoKeyPair;
				return keyFileText(pair, "fabrika agent");
			},
			catch: (cause) => new ConnectFailed({why: `the agent's key could not be made: ${cause}`}),
		});
		yield* fs.writeFileString(file, text, {mode: 0o600});
		return file;
	});

/** The home's shared ledger as agent `name`, for the home's person: its Ledger and Author. */
export const asAgent = (home: string, name: string) =>
	Layer.unwrap(
		Effect.gen(function* () {
			if (!isAgentName(name))
				return yield* new ConnectFailed({
					why: `${name} is not an agent's name: lower-case letters, digits, dots, dashes, underscores`,
				});
			const found = yield* connectionOf(home);
			if (Option.isNone(found))
				return yield* new ConnectFailed({
					why: "this home has no ledger server: fabrika connect first",
				});
			const c = found.value;
			const agent = layerSignerFile(yield* agentKeyOf(home));
			const key = yield* Effect.gen(function* () {
				return (yield* Signer).key;
			}).pipe(Effect.provide(agent));
			const g = yield* grant({
				address: `${c.url}/${c.ledger}`,
				agent: name,
				key,
				for: c.login,
				expires: Date.now() + GRANT_MS,
			}).pipe(Effect.provide(layerSignerFile(c.key)));
			const login = doorOf(c).agentLogin(g).pipe(Effect.provide(agent));
			const session = yield* login.pipe(
				Effect.catchIf(
					(e) => e instanceof DoorRefused && e.status === 403,
					() => loginWith(c).pipe(Effect.andThen(login)),
				),
				Effect.catchTag("KeyUnreadable", (e) =>
					Effect.fail(new ConnectFailed({why: `the key ${e.path}: ${e.why}`})),
				),
			);
			return Layer.merge(
				layerHttp({url: c.url, ledger: c.ledger, token: session.token}),
				Layer.succeed(Author, session.who),
			);
		}),
	);

/** A ticket as one line: `#9 open c28 The ledger moves to Cloudflare`. */
const lineOf = (t: {number: number; state: string; comments: number; title: string}) =>
	`#${t.number} ${t.state} c${t.comments} ${t.title}`;

/**
 * Tell the tracker `writes` as agent `name`, then answer the tickets, one line each. A run ends
 * only when every write is on the ledger, so the list after it shows them. The first write the
 * ledger refused fails the post, with why.
 */
export const post = (home: string, name: string, writes: ReadonlyArray<Do>) =>
	Effect.gen(function* () {
		const services = yield* Layer.build(Layer.merge(asAgent(home, name), pullRequestsOf([])));
		const view = viewOf(tracker);
		if (view === undefined) return yield* Effect.die("the tracker has no view");
		const ready = (id: string) =>
			Effect.gen(function* () {
				const started = yield* start(tracker, {}, {}, {id, storage: memoryStorage()}).pipe(
					Effect.provideContext(services),
				);
				if (started.kind !== "running") return yield* Effect.die("the tracker did not start");
				const shown = yield* started.run.machines.tickets.changes.pipe(
					Stream.filter((s) => s !== null),
					Stream.map((s) => view.of(s) as Shown),
					Stream.filter((s) => s.ready),
					Stream.runHead,
					Effect.map(Option.getOrThrow),
				);
				return {run: started.run, shown};
			});
		const writing = yield* ready(`tracker:post:${name}`);
		const refused = yield* Ref.make<string | null>(null);
		yield* writing.run.machines.tickets.changes.pipe(
			Stream.runForEach((s) =>
				s?.failed == null
					? Effect.void
					: Ref.update(refused, (first) => first ?? s.failed?.why ?? null),
			),
			Effect.forkScoped,
		);
		for (const w of writes) yield* offer(writing.run, "do", w);
		yield* offer(writing.run, "do", {kind: "quit"});
		yield* writing.run.ended;
		const why = yield* Ref.get(refused);
		if (why !== null) return yield* new PostFailed({why});
		const after = yield* ready(`tracker:post:${name}:after`);
		yield* offer(after.run, "do", {kind: "quit"});
		return after.shown.page.kind === "list" ? after.shown.page.tickets.map(lineOf) : [];
	}).pipe(Effect.scoped);
