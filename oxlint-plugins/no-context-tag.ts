// Ban the pre-v4 service forms `Context.Tag(...)` / `Context.GenericTag(...)` /
// `Effect.Service(...)`: require Effect-v4 `Context.Service`.
//
// Rationale (single site; .patterns/effect-context-service.md, in the pipeline this repo
// rebuilds): the code is on Effect v4. The v3 service idioms, `Context.Tag`,
// `Context.GenericTag` and the `Effect.Service` helper, are wrong here; the single v4 idiom is
// `class S extends Context.Service<S, Shape>()("id") {}`. This rule is a pure regression gate:
// the repo scan for #2736 found ZERO existing violations (the codebase was already all-v4), so it
// exists only to stop a v3 form from re-entering.
//
// Matched on the member itself (`Context.Tag` etc.) rather than a call, because the forms differ
// in arity and type arguments (`Context.Tag("id")<S, Shape>()`, `Context.GenericTag<Shape>("id")`,
// `Effect.Service<S>()("id", {...})`): the bare member is the stable shape common to all of them.
// That includes a type (`type T = Context.Tag`, `interface I extends Context.Tag<X>`).
//
// A genuine exception is a per-line
// `// oxlint-disable-next-line fabrika/no-context-tag -- <reason>`.
import type {CreateRule} from "@oxlint/plugins";
import {banNames} from "./match.ts";

const fix =
	"Fix: define the service as `class S extends Context.Service<S, Shape>()('id') {}`: copy `packages/fate-effect/src/CurrentUser.ts` (or `apps/web/worker/db/Drizzle.ts`). Exception: // oxlint-disable-next-line fabrika/no-context-tag -- <reason>.";

export const noContextTag: CreateRule = {
	create: banNames({
		"Context.Tag": `\`Context.Tag(...)\` is the Effect-v3 service form and is banned: this code is on Effect v4 (.patterns/effect-context-service.md; #2736). ${fix}`,
		"Context.GenericTag": `\`Context.GenericTag(...)\` is the Effect-v3 service form and is banned: this code is on Effect v4 (.patterns/effect-context-service.md; #2736). ${fix}`,
		"Effect.Service": `\`Effect.Service(...)\` is not used here: v4 uses \`Context.Service\` only (.patterns/effect-context-service.md; #2736). ${fix}`,
	}),
};
