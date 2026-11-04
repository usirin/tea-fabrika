import {Context, Duration, Effect, Schedule} from "effect";
import type {Service} from "./stages/pipeline/routes.ts";

// The one wait (docs/direction/jidoka-and-andon.md#bounds, self-fix PR 11b). Today's version. A
// service that owns a read, or a write with its own key, wraps its transport in it. A transient error
// is tried again, from 1 second, doubling, up to 100 seconds apart, with no cap on tries: Temporal's
// default retry policy, at one point in the stack (AWS). A refusal reaches the caller at once, as it
// was, and the lane stops with its real why.
//
//   waitOut(ledger.readStream(inbox), (e) => e._tag === "LedgerUnreachable", "tickets")
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
		return yield* Effect.retry(effect, {
			while: isTransient,
			schedule: GAPS.pipe(
				Schedule.tap(({duration, attempt}) =>
					heard(
						`waits on ${what}: no answer on try ${attempt}, trying again in ${Duration.format(duration)}`,
					),
				),
			),
		});
	});
