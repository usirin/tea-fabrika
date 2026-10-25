import {Schema} from "effect";

// Brief: one schema per role, filled by code, and turned into the agent's
// first message by a render function (docs/direction/new-combos.md). The
// markdown is a view made from the data and is never read back
// (docs/direction/data-first-markdown-is-a-view.md).
//
// The point is poka-yoke: what a role's schema has no field for cannot reach
// that agent. A reviewer's brief with no field for the chat cannot carry the
// chat, so the reviewer reads the diff the way a stranger would. Two locks
// hold that:
//
//   the type      `fill` takes only the schema's top-level fields: an extra
//                 one is a compile error, from a literal or a wider value alike
//   the decode    Effect Schema with `onExcessProperty: "error"`, at every
//                 depth, so an extra field deeper down, or one that got past
//                 the type, throws
//
// A builder that hands a role more than its schema allows is a bug in code,
// not a state of the world, so `fill` throws instead of answering with a Msg.
//
// The Elm answer: a view is a function of the model, and each role's model
// is its own type. `createRefineLoop` (src/combos.ts) already takes a `brief`;
// `prompt` here is the shape its `prompt` takes.

/** A role's brief schema: plain data, the same type on both sides, so what is filled is what decodes. */
export type BriefSchema<T> = Schema.Codec<T, T>;

/** `I`, with every field `T` has no slot for typed `never`: an extra field does not compile. */
export type Only<T, I> = I & {readonly [K in Exclude<keyof I, keyof T>]: never};

export interface Brief<R extends string, T> {
	readonly role: R;
	readonly schema: BriefSchema<T>;
	/** Check a filled brief against the role's schema; an extra field anywhere throws. */
	readonly fill: <I extends T>(brief: Only<T, I>) => T;
	/** The agent's first message, made from the brief. */
	readonly render: (brief: T) => string;
	/** A refine loop's prompt: the brief on the first try, the Check's note after it, in the same conversation. */
	readonly prompt: (brief: T, note: string | null) => string;
}

/** The brief a {@link Brief} fills. */
export type BriefOf<B> = B extends Brief<string, infer T> ? T : never;

/** Define one role's brief: its name, its schema, and how it reads as a message. */
export function defineBrief<const R extends string, T>(config: {
	readonly role: R;
	readonly schema: BriefSchema<T>;
	readonly render: (brief: T) => string;
}): Brief<R, T> {
	const decode = Schema.decodeUnknownSync(config.schema, {onExcessProperty: "error"});
	const {role, schema, render} = config;
	return {
		role,
		schema,
		fill: (brief) => decode(brief),
		render,
		prompt: (brief, note) => (note === null ? render(brief) : note),
	};
}
