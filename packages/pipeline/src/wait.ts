import {Context, Duration, Effect, Schedule} from "effect";
import type {Service} from "./stages/pipeline/routes.ts";

// The one wait (docs/direction/jidoka-and-andon.md#bounds, self-fix PR 11b). Today's version. A
// service that owns a read, or a write with its own key, wraps its transport in it. A transient error
// is tried again, from 1 second, doubling, up to 100 seconds apart, with no cap on tries: Temporal's
// default retry policy, at one point in the stack (AWS). A refusal reaches the caller at once, as it
// was, and the lane stops with its real why.
//
//   waitOut(ledger.readStream(inbox), ledgerBusy, "tickets")
//   // tries at 0 s, 1 s, 3 s, 7 s, ... 127 s, 227 s, ... until the ledger answers
//
// Nothing in the lane or a step tries again what a service waited out (P8).

/**
 * What each service in a `wait` row waits on, in the words its tile says (./stages/pipeline/routes.ts
 * `Service`). Tickets and the ledger's claim wait today. The work service, the code host and the
 * review pack name no transient error yet, so their `wait` rows still stop the lane.
 */
export const WAITS = {
	tickets: "the ledger, for the ticket",
	ledger: "the ledger, for the claim",
	work: "git",
	code_host: "the code host",
	review_pack: "the review pack",
} as const satisfies Readonly<Record<Service, string>>;

/** The gaps between tries: 1 second, doubling, 100 seconds at most. It never stops by itself. */
const GAPS = Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("100 seconds")]);

/**
 * Who hears that a service waits: the lane's tile, which says what it waits on, as Polly's `onRetry`
 * does. Left unset, a warning in the log.
 */
export const OnWait = Context.Reference<(line: string) => Effect.Effect<void>>("pipeline/OnWait", {
	defaultValue: () => (line) => Effect.logWarning(line),
});

/**
 * A ledger error worth waiting out: no answer at all (no `status`), or an answer that says "busy",
 * a 408, a 429 or a 5xx. A refusal (a 400, a 401 after a failed renew, a 403, a 404, the door's
 * refusal) is not, and reaches the caller at once with the ledger's own words. Nor is an answer the
 * ledger would give again (a `why`: one this code cannot read, or its own store's error).
 */
export const ledgerBusy = (e: {
	readonly _tag: string;
	readonly status?: number;
	readonly why?: string;
}): boolean =>
	e._tag === "LedgerUnreachable" &&
	e.why === undefined &&
	(e.status === undefined || e.status === 408 || e.status === 429 || e.status >= 500);

/** What a try met, in the tile's words: the service's own text when it answered, else `no answer`. */
const met = (error: unknown): string =>
	typeof error === "object" &&
	error !== null &&
	"status" in error &&
	typeof error.status === "number" &&
	"message" in error &&
	typeof error.message === "string"
		? error.message
		: "no answer";

/**
 * `effect`, tried again on each error `isTransient` names, on the one schedule, until it answers. Any
 * other error reaches the caller at once. `on`: the service that waits, for the words its tile says.
 */
export const waitOut = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	isTransient: (error: E) => boolean,
	on?: Service,
): Effect.Effect<A, E, R> =>
	Effect.gen(function* () {
		const heard = yield* OnWait;
		const what = on === undefined ? "the service" : WAITS[on];
		// The schedule judges each error itself, so the tile hears only a try that is really waited out.
		return yield* Effect.retry(
			effect,
			GAPS.pipe(
				Schedule.setInputType<E>(),
				Schedule.while(({input}) => isTransient(input)),
				Schedule.tap(({duration, attempt, input}) =>
					heard(
						`waits on ${what}: ${met(input)} on try ${attempt}, trying again in ${Duration.format(duration)}`,
					),
				),
			),
		);
	});
