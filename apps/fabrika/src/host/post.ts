// `fabrika post`: an agent's write to the tracker on the home's shared ledger, as that agent, for
// the home's person. The door stamps it `agent:<name>` for that person, and an agent's session
// cannot answer an ask, so a post never approves anything (door.ts).
//
//   yield* post(home, "triage", [{type: "comment", value: {ticket: 9, body: "Plan ready."}}])
//   // ["#9 open c28 The ledger moves to Cloudflare", ...]
//
// The post writes on the agent's own session, the one the host's agents get too
// (host/agent-session.ts): the home's agent key, a grant for this name signed with the person's
// key, and the agent's login. Its session ends with the post.
import {type InputMsgOf, memoryStorage, offer, start, viewOf} from "@kampus/fabrika-old";
import {pullRequestsOf, type Shown, tracker} from "@tea-fabrika/tracker";
import {Effect, Layer, Option, Ref, Schema, Stream} from "effect";
import {agentLedger} from "./agent-session.ts";

export {AGENT_KEY} from "./agent-session.ts";

/** One write a post tells the tracker, as its window sends it: a file, a comment or a close. */
export type Post = Extract<
	InputMsgOf<typeof tracker>,
	{readonly type: "file" | "comment" | "close"}
>;

/** A post the tracker refused, with why in words. */
class PostFailed extends Schema.TaggedError<PostFailed>()("PostFailed", {
	why: Schema.String,
}) {}

/** A ticket as one line: `#9 open c28 The ledger moves to Cloudflare`. */
const lineOf = (t: {number: number; state: string; comments: number; title: string}) =>
	`#${t.number} ${t.state} c${t.comments} ${t.title}`;

/**
 * Tell the tracker `writes` as agent `name`, then answer the tickets, one line each. A run ends
 * only when every write is on the ledger, so the list after it shows them. Each write is checked
 * against its input's own shape first, as an agent's tool call is (mcp/tools.ts): one that does
 * not fit fails the post, with why, before anything is told. The first write the ledger refused
 * fails it too.
 */
export const post = (home: string, name: string, writes: ReadonlyArray<Post>) =>
	Effect.gen(function* () {
		for (const w of writes) {
			const misfit = tracker.inputs[w.type].shape.problem(w.value);

			if (misfit !== undefined) {
				return yield* new PostFailed({why: `${w.type} does not fit: ${misfit}`});
			}
		}

		const services = yield* Layer.build(Layer.merge(agentLedger(home, name), pullRequestsOf([])));
		const view = viewOf(tracker);

		if (view === undefined) {
			return yield* Effect.die("the tracker has no view");
		}

		const ready = (id: string) =>
			Effect.gen(function* () {
				const started = yield* start(tracker, {}, {}, {id, storage: memoryStorage()}).pipe(
					Effect.provideContext(services),
				);

				if (started.kind !== "running") {
					return yield* Effect.die("the tracker did not start");
				}

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

		// Told one after another; the run reads them in that order, across its inputs, then quits.
		for (const w of writes) {
			yield* offer(writing.run, w.type, w.value);
		}

		yield* offer(writing.run, "quit", null);
		yield* writing.run.ended;
		const why = yield* Ref.get(refused);

		if (why !== null) {
			return yield* new PostFailed({why});
		}

		const after = yield* ready(`tracker:post:${name}:after`);
		yield* offer(after.run, "quit", null);
		return after.shown.page.kind === "list" ? after.shown.page.tickets.map(lineOf) : [];
	}).pipe(Effect.scoped);
