// Ban `class ... extends Data.TaggedError(...)`: require `Schema.TaggedErrorClass`.
//
// Rationale (single site; .patterns/effect-errors.md, in the pipeline this repo rebuilds): every
// error class is a `Schema.TaggedErrorClass` so the `FateWireCode` wire-code annotation can ride the
// class's AST; `Data.TaggedError` has nowhere to put one. The ban applies uniformly, including
// CLI-only errors that never reach the wire (the verb package's own gold boundary files already use
// `Schema.TaggedErrorClass` for CLI-only errors; a wire/non-wire split would fragment the rule for
// no benefit: #2736 resolved).
//
// Matched on the member `Data.TaggedError` (the extends-clause is a call
// `Data.TaggedError("Tag")<Shape>`), the stable shape across its arity and type-argument variants.
//
// A genuine exception is a per-line
// `// oxlint-disable-next-line fabrika/no-data-taggederror -- <reason>`.
import type {CreateRule} from "@oxlint/plugins";
import {banNames} from "./match.ts";

export const noDataTaggederror: CreateRule = {
	create: banNames({
		"Data.TaggedError":
			"`class ... extends Data.TaggedError` is banned: errors must be `Schema.TaggedErrorClass` so the `FateWireCode` annotation can ride the AST (.patterns/effect-errors.md; #2736). Fix: `class MyError extends Schema.TaggedErrorClass<MyError>()('feature/MyError', { ...fields }, { [FateWireCode]: 'CODE' }) {}`: copy `packages/fate-effect/src/CurrentUser.ts` (or `packages/fabrika-cli/src/io/fs.ts` for a CLI-only error). Exception: // oxlint-disable-next-line fabrika/no-data-taggederror -- <reason>.",
	}),
};
