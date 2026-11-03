import {createHash} from "node:crypto";
import {Schema} from "effect";

// A mutant, as the mutation step hands it on and the test writer's mutants
// job reads it (docs/direction/the-test-writer.md). Both import it from here.

/**
 * A mutant by where it is and what it does: `file:line:column:tag`, line and
 * column counted from 1. `tag` is 6 hex digits of its mutator and its
 * replacement, so two mutants at one spot never share an id. A file's name may
 * hold any letter but a line break, a space or a colon too, so an id is read
 * from its end ({@link placeIn}).
 */
const ID = /^([^\r\n]+):([1-9][0-9]*):([1-9][0-9]*):[0-9a-f]{6}$/;
export const MutantId = Schema.String.check(Schema.isPattern(ID));
export type MutantId = typeof MutantId.Type;

/** The file and line a mutant's id names. Pure. */
export const placeIn = (id: MutantId): {readonly file: string; readonly line: number} => {
	const [, file = "", line = "1"] = ID.exec(id) ?? [];
	return {file, line: Number(line)};
};

/** One mutant that survived: no test of the repo failed with it in, and the typecheck took it. */
export const Survived = Schema.Struct({
	mutant: MutantId,
	/** Stryker's name for the kind of change, such as `EqualityOperator`. */
	mutator: Schema.String,
	/** The code it replaced, and what it put there. */
	original: Schema.String,
	replacement: Schema.String,
});
export type Survived = typeof Survived.Type;

/** A mutant's place, line and column counted from 1, and what it puts there. */
export interface Place {
	readonly file: string;
	readonly line: number;
	readonly column: number;
	readonly mutator: string;
	readonly replacement: string;
}

/** The id of a mutant. The same mutant gets the same id on every run. */
export const idOf = (m: Place): MutantId => {
	const tag = createHash("sha256")
		.update(JSON.stringify([m.mutator, m.replacement]))
		.digest("hex")
		.slice(0, 6);
	return Schema.decodeSync(MutantId)(`${m.file}:${m.line}:${m.column}:${tag}`);
};
