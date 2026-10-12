import {Schema} from "effect";

// What a stage machine hands back, in the one shape every stage uses
// (docs/direction/outcome-names.md). Five verbs:
//
//   done   the job is finished, wholly or in part        nobody is next
//   send   another stage has to do something             that stage
//   ask    a person has to decide or act                 that person
//   skip   there is nothing here for this stage to do    nobody
//   stuck  something could not be read: stop, never guess  nobody
//
// The data is the truth. A parent does a `switch` on it. Its name is how it
// is spelled for people, logs and drawings, by one grammar:
//
//   passing it on   verb:who:why    send:builder:checks_red   ask:owner:approval
//   ending here     verb:why        done   done:part   skip:closed   stuck:read_failed
//
// A stage writes only its own words (`outcomesOf`). `nameOf` makes the name
// from the data, so the two cannot drift, and the name's pattern is a type,
// so a misspelled name does not compile.

/** Any stage's outcome, as far as the shape goes. */
export type AnyOutcome =
	| {readonly kind: "done"; readonly part: boolean}
	| {readonly kind: "send"; readonly to: string; readonly why: string}
	| {readonly kind: "ask"; readonly who: string; readonly for: string}
	| {readonly kind: "skip"; readonly why: string}
	| {readonly kind: "stuck"; readonly why: string};

/**
 * A stage's own words. `send` and `ask` list what may be said to each one it
 * passes work to, so a pair that makes no sense (a reviewer sent red checks)
 * is not a value of the type.
 */
export interface Words {
	/** What a `done` carries besides `part`. */
	readonly done: Schema.Struct.Fields;
	/** For each stage it sends work to: why. */
	readonly send: Readonly<Record<string, readonly string[]>>;
	/** For each person it asks: for what. */
	readonly ask: Readonly<Record<string, readonly string[]>>;
	readonly skip: readonly string[];
	readonly stuck: readonly string[];
}

/** The outcome type a stage's words make. */
export type OutcomeOf<W extends Words> =
	| ({readonly kind: "done"; readonly part: boolean} & Schema.Struct<W["done"]>["Type"])
	| {
			readonly [T in keyof W["send"] & string]: {
				readonly kind: "send";
				readonly to: T;
				readonly why: W["send"][T][number];
			};
	  }[keyof W["send"] & string]
	| {
			readonly [P in keyof W["ask"] & string]: {
				readonly kind: "ask";
				readonly who: P;
				readonly for: W["ask"][P][number];
			};
	  }[keyof W["ask"] & string]
	| {readonly kind: "skip"; readonly why: W["skip"][number]}
	| {readonly kind: "stuck"; readonly why: W["stuck"][number]};

/** The name of an outcome, as a type: every name a stage can print, and no other text. */
export type Name<O extends AnyOutcome> = O extends {readonly kind: "done"}
	? "done" | "done:part"
	: O extends {
				readonly kind: "send";
				readonly to: infer T extends string;
				readonly why: infer Y extends string;
			}
		? `send:${T}:${Y}`
		: O extends {
					readonly kind: "ask";
					readonly who: infer P extends string;
					readonly for: infer F extends string;
				}
			? `ask:${P}:${F}`
			: O extends {readonly kind: "skip" | "stuck"; readonly why: infer Y extends string}
				? `${O["kind"]}:${Y}`
				: never;

/** How an outcome is spelled. Passing on says who, then why. Ending says why. A whole `done` has nothing to add. */
export function nameOf<O extends AnyOutcome>(outcome: O): Name<O>;
export function nameOf(outcome: AnyOutcome): string {
	switch (outcome.kind) {
		case "done":
			return outcome.part ? "done:part" : "done";
		case "send":
			return `send:${outcome.to}:${outcome.why}`;
		case "ask":
			return `ask:${outcome.who}:${outcome.for}`;
		case "skip":
		case "stuck":
			return `${outcome.kind}:${outcome.why}`;
	}
}

/**
 * What a name holds: the verb, who gets the work next, and why. A name that
 * ends here has no `who`. A whole `done` has no `why`. An `ask`'s `why` is
 * what is asked for. It is not the whole outcome: a name holds no commit.
 */
export type Parts<N extends string> = N extends `${infer V}:${infer A}:${infer B}`
	? {readonly verb: V; readonly who: A; readonly why: B}
	: N extends `${infer V}:${infer Y}`
		? {readonly verb: V; readonly who: null; readonly why: Y}
		: {readonly verb: N; readonly who: null; readonly why: null};

/** A name, read back into its parts. */
export function partsOf<N extends string>(name: N): Parts<N>;
export function partsOf(name: string): {
	readonly verb: string;
	readonly who: string | null;
	readonly why: string | null;
} {
	const [verb = "", second = null, third = null] = name.split(":");
	return third === null ? {verb, who: null, why: second} : {verb, who: second, why: third};
}

const literals = (words: readonly string[]) =>
	Schema.Literals(words as readonly [string, ...string[]]);

/**
 * A stage's outcomes, made from its words: the schema, every name it can
 * print, and a test for "is this text one of them", for a name read back from
 * a log.
 */
export function outcomesOf<const W extends Words>(words: W) {
	type O = OutcomeOf<W>;
	const members = [
		Schema.Struct({kind: Schema.Literal("done"), part: Schema.Boolean, ...words.done}),
		...Object.entries(words.send).map(([to, whys]) =>
			Schema.Struct({kind: Schema.Literal("send"), to: Schema.Literal(to), why: literals(whys)}),
		),
		...Object.entries(words.ask).map(([who, fors]) =>
			Schema.Struct({kind: Schema.Literal("ask"), who: Schema.Literal(who), for: literals(fors)}),
		),
		Schema.Struct({kind: Schema.Literal("skip"), why: literals(words.skip)}),
		Schema.Struct({kind: Schema.Literal("stuck"), why: literals(words.stuck)}),
	];
	// The cast says what the lines above built, which TypeScript cannot follow through a list made in a loop.
	const schema = Schema.Union(members) as Schema.Codec<O, O>;
	const names = [
		"done",
		"done:part",
		...Object.entries(words.send).flatMap(([to, whys]) => whys.map((why) => `send:${to}:${why}`)),
		...Object.entries(words.ask).flatMap(([who, fors]) => fors.map((what) => `ask:${who}:${what}`)),
		...words.skip.map((why) => `skip:${why}`),
		...words.stuck.map((why) => `stuck:${why}`),
	] as readonly Name<O>[];
	const isName = (text: string): text is Name<O> => (names as readonly string[]).includes(text);
	return {schema, names, isName};
}
