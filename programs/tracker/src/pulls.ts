import {Context, Duration, Effect, Layer, Schema, Stream} from "effect";
import type {PullsSub, pulls} from "./machine.ts";

// The open pull requests the tracker's list shows next to the tickets, and the door they come in
// through: the `Pulls` service. The tracker is its own thing, tied to no repository, the way Linear
// is; GitHub is one integration behind this door (./github.ts).
//
//   Pulls.open
//   // [{repo: "https://github.com/<owner>/<name>", number: 113, title: "...", url: ..., draft: false, at: ...}]
//
//   pullsOf([...])      a fixed list, for a test; pullsOf([]) for none
//
// A pull request's title is anyone's words: on a public repository a stranger can open one. The
// window draws it as text.

/** An open pull request, as the tracker's list shows it. `at`: when it last changed, in ms. */
export const Pull = Schema.Struct({
	/** The repository's URL, `https://github.com/<owner>/<name>`. */
	repo: Schema.String,
	number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	title: Schema.String,
	/** Its page. Only GitHub's own: the window hands it to the person's browser. */
	url: Schema.String.check(Schema.isPattern(/^https:\/\/github\.com\//)),
	draft: Schema.Boolean,
	at: Schema.Finite,
});
export type Pull = typeof Pull.Type;

/** The pull requests could not be read, and why in words. */
export type PullsUnreachable = {readonly _tag: "unreachable"; readonly why: string};

/** The door: the open pull requests of every connected repository. */
export class Pulls extends Context.Service<
	Pulls,
	{readonly open: Effect.Effect<readonly Pull[], PullsUnreachable>}
>()("@tea-fabrika/tracker/Pulls") {}

/** A fixed list, for a test or a host with no integration. */
export const pullsOf = (list: readonly Pull[]) =>
	Layer.succeed(Pulls, {open: Effect.succeed(list)});

/** A repository's short name, `<name>`, from its URL. */
export const nameOf = (repo: string) => repo.replace(/\/+$/, "").split("/").at(-1) ?? repo;

/** How long the list waits before it reads the pull requests again. */
export const PULLS_EVERY = Duration.minutes(2);

/** Read the open pull requests: the `pulls` Cmd's cell. */
export const pullsCell = (_cmd: ReturnType<typeof pulls>) =>
	Effect.gen(function* () {
		return {pulls: yield* (yield* Pulls).open};
	});

/** `refresh`, once `PULLS_EVERY` has gone by. */
export const pullsWaitRunner = (_sub: PullsSub) =>
	Stream.fromEffect(Effect.sleep(PULLS_EVERY)).pipe(Stream.map(() => ({type: "refresh" as const})));
