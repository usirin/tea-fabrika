import {Schema} from "effect";

// A mutant, as the mutation step hands it on and the test writer's mutants
// job reads it (docs/direction/the-test-writer.md). Both import it from here.

/** A mutant by where it is: `file:line:column`, both counted from 1. */
export const MutantId = Schema.String.check(Schema.isPattern(/^[^:\s]+:[1-9][0-9]*:[1-9][0-9]*$/));
export type MutantId = typeof MutantId.Type;

/** One mutant that lived: no test of the repo failed with it in, and the typecheck took it. */
export const Lived = Schema.Struct({
	mutant: MutantId,
	/** Stryker's name for the kind of change, such as `EqualityOperator`. */
	mutator: Schema.String,
	/** The code it replaced, and what it put there. */
	original: Schema.String,
	replacement: Schema.String,
});
export type Lived = typeof Lived.Type;

/** The id of a mutant at `file`, `line` and `column`. */
export const idOf = (file: string, line: number, column: number): MutantId =>
	Schema.decodeSync(MutantId)(`${file}:${line}:${column}`);
