// Ban a bare numeric-literal argument to the effect duration-taking APIs: require an
// `effect/Duration` value (or a unit-tagged string like "100 millis") so the unit is
// unambiguous at the call site.
//
// Rationale (single site; #3196): Effect's `Duration.Input` accepts a bare `number`
// interpreted as *milliseconds*. `Effect.sleep(5000)` and `Schedule.spaced(1000)` read
// as "5000 of something" / "1000 of something": the unit lives only in the reader's
// head, and a "seconds" mistake (`sleep(5)` meaning to wait 5s but actually waiting 5ms)
// is invisible at the call site. `Duration.seconds(5)` / `Duration.millis(5000)` (or the
// tagged string form the codebase already uses, `"100 millis"`) names the unit in the
// source. The rule sees no types, so this stays syntactic: it flags only a numeric
// LITERAL in the duration position of the named APIs: a `Duration.*` value, a tagged
// string, or a variable are all left alone.
//
// Scope discriminator (low false-positive by construction, grounded in effect@4.0-beta
// Schedule.ts / Effect.ts): only the DURATION-taking APIs are named. `Effect.sleep`,
// `Effect.timeout`, `Effect.delay` take `Duration.Input`; among the Schedule combinators
// `spaced`/`exponential`/`fixed`/`windowed` take `Duration.Input`, but `Schedule.recurs(n)`
// takes a repetition COUNT, a legitimate bare number, and is deliberately NOT flagged
// (nor are the schedule-combining `both`/`jittered`/`union`/... which take schedules, not
// numbers). `exponential`'s optional second arg is a numeric `factor` multiplier, also a
// legitimate bare number, so only its first (base duration) position is matched.
//
// A genuine exception is a per-line
// `// oxlint-disable-next-line fabrika/no-numeric-duration -- <reason>`.
import type {CreateRule} from "@oxlint/plugins";
import {grouped, type Node, plainCall} from "./match.ts";

/** For each API, by its number of arguments, which argument is the duration. */
const POSITION: Readonly<Record<string, Readonly<Record<number, number>>>> = {
	"Effect.sleep": {1: 0},
	"Effect.timeout": {1: 0, 2: 1},
	"Effect.delay": {1: 0, 2: 1},
	"Schedule.spaced": {1: 0},
	"Schedule.fixed": {1: 0},
	"Schedule.windowed": {1: 0},
	"Schedule.exponential": {1: 0, 2: 0},
};

const isNumber = (node: Node): boolean => node.type === "Literal" && typeof node.value === "number";

export const noNumericDuration: CreateRule = {
	create(context) {
		return {
			CallExpression(node) {
				const name = plainCall(node);
				const where = name === null ? undefined : POSITION[name]?.[node.arguments.length];
				if (where === undefined) return;
				const duration = node.arguments[where];
				if (duration === undefined || !isNumber(duration)) return;
				if (grouped(context.sourceCode, duration) > 0) return;
				context.report({
					node: duration,
					message:
						'Bare numeric duration is banned: a `number` is interpreted as milliseconds, so the unit is invisible at the call site (#3196). Fix: use `Duration.seconds(...)`/`Duration.millis(...)` or a unit-tagged string like `"5 seconds"`. Exception: // oxlint-disable-next-line fabrika/no-numeric-duration -- <reason>.',
				});
			},
		};
	},
};
