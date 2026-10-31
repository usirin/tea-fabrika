// Ban a sequential-default Effect combinator (`Effect.all` / `Effect.forEach` /
// `Effect.validate`) written WITHOUT an explicit `concurrency` option: make the
// serial-vs-parallel choice visible at the call site instead of an invisible default.
//
// Rationale (single site; .patterns/serial-read-baseline.md): these combinators default
// to `concurrency: 1`: effect@4.0.0-beta.92 `Effect.forEach` documents "By default, the
// operations are performed sequentially", and `Effect.all` over an iterable delegates to
// the same `forEach`. So `Effect.all([a, b, c])` runs three INDEPENDENT effects strictly
// in series and the reader cannot tell whether that serialization was chosen or inherited.
// The finalized-read stamp chain paid exactly this cost: N cross-region D1 round trips in
// sequence for no ordering reason (the #2567 serial-read baseline, remediated with an
// explicit `{concurrency: "unbounded"}` wave in apps/web/worker/features/fate/stamp-wave.ts).
// Requiring the option forces the author to state the intent: `"unbounded"` / `<n>` to fan
// out, or `1` (with a reason) to keep it serial on purpose.
//
// The rule sees no types, so it stays syntactic: match the call on its `Effect.<name>` callee at
// any arity, then exempt any call whose text names `concurrency` as a word of code. A call that
// passes `{ concurrency: ... }` at any value is left alone, as is `{concurrency}` and
// `opts.concurrency`; a call with no options object, or an options object that omits
// `concurrency`, is flagged. So is a quoted `{"concurrency": 1}`: the word in a string does not
// count. `Effect.validate` is the element-validating form (`Effect.validate(elements, f, options?)`),
// which shares the same sequential default. Sibling sequential-default collectors (`partition`) are
// deliberately out of scope until a call site needs them.
//
// A genuine intentionally-serial site is exempted per-line with a
// `// oxlint-disable-next-line fabrika/no-implicit-effect-concurrency -- <reason>`, never a blanket
// exemption.
import type {CreateRule} from "@oxlint/plugins";
import {plainCall} from "./match.ts";

const WHAT: Readonly<Record<string, string>> = {
	"Effect.all": "`Effect.all(...)` runs its effects SEQUENTIALLY by default",
	"Effect.forEach": "`Effect.forEach(...)` runs SEQUENTIALLY by default",
	"Effect.validate": "`Effect.validate(...)` runs SEQUENTIALLY by default",
};

export const noImplicitEffectConcurrency: CreateRule = {
	create(context) {
		return {
			CallExpression(node) {
				const name = plainCall(node);
				const what = name === null ? undefined : WHAT[name];
				if (what === undefined) return;
				const names = context.sourceCode
					.getTokens(node)
					.some((token) => token.type === "Identifier" && token.value === "concurrency");
				if (names) return;
				context.report({
					node,
					message: `${what}: with no explicit \`concurrency\` the serial-vs-parallel choice is invisible at the call site (.patterns/serial-read-baseline.md; #2567). Fix: pass \`{ concurrency: "unbounded" }\` (or \`<n>\`) to fan out, or \`{ concurrency: 1 }\` to keep it serial on purpose. Exception: // oxlint-disable-next-line fabrika/no-implicit-effect-concurrency -- <reason>.`,
				});
			},
		};
	},
};
