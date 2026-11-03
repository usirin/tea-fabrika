import {defineProgram, input, output} from "@kampus/fabrika-old";
import type {Attachment} from "@kampus/pipeline/asks/ask";
import type {Pack} from "@kampus/pipeline/asks/packs";
import {Built, Cleared, Raise} from "@kampus/pipeline/asks/program";
import {Context, Effect, Layer, Schema} from "effect";

// A pack for repos whose work changes what a user sees
// (docs/direction/packs-are-programs.md, "Example: a ui-verification pack").
// It hears every build the core says and holds it:
//
//   nothing a user sees changed  ->  it clears the build; the core ships it as usual
//   something a user sees changed ->  it raises one check: "this is what changes,
//                                     yes or no?", with before and after pictures
//
// The owner's answer goes to the core, not to this pack: yes ships, no makes
// the note a new criterion and sends the task back to build. Whoever shows the
// check to the owner (an owner-desk pack, or nobody) is not this pack's
// business, and it names none.
//
// A stand-in: `Shots` names the pictures it would take and takes none.

/** Who this pack is, on what it raises. */
export const BY = "ui-verification";

/** Before and after pictures of a build, and a short video. */
export class Shots extends Context.Service<
	Shots,
	{readonly of: (built: Built) => Effect.Effect<readonly Attachment[]>}
>()("Shots") {}

/** The stand-in: names where the pictures would be, under `folder`. */
export const fakeShots = (folder: string) =>
	Layer.succeed(Shots, {
		of: (b) => {
			// A plan is named `owner/repo#N`: the pictures are under its number.
			const stem = `${folder}/${b.plan.split("#").at(-1)}-${b.task}-b${b.build}`;
			return Effect.succeed([
				{label: "before", ref: `${stem}-before.png`},
				{label: "after", ref: `${stem}-after.png`},
				{label: "the change, 10 seconds", ref: `${stem}.webm`},
			]);
		},
	});

/** Which paths a user sees, as patterns. */
export class Seen extends Context.Service<Seen, {readonly patterns: readonly RegExp[]}>()("Seen") {}

/** The changed files a user sees. Pure. */
export const visibleOf = (changes: readonly string[], patterns: readonly RegExp[]) =>
	changes.filter((path) => patterns.some((p) => p.test(path)));

export const uiProgram = defineProgram({
	name: "ui-verification",
	description:
		"Holds each build: clears it when nothing a user sees changed, else asks the owner yes or no with before and after pictures.",
	inputs: {
		built: input(Built, "Each build the core says."),
	},
	outputs: {
		cleared: output(Cleared, "A build nothing a user sees changed in."),
		raise: output(Raise, "A build that changes what a user sees, to check."),
	},
	main: ({serve, send}) =>
		Effect.gen(function* () {
			const shots = yield* Shots;
			const {patterns} = yield* Seen;
			yield* serve({
				built: (b) =>
					Effect.gen(function* () {
						const ref = {plan: b.plan, task: b.task, build: b.build, by: BY};
						const seen = visibleOf(b.changes, patterns);
						if (seen.length === 0) return yield* send("cleared", ref);
						yield* send("raise", {
							...ref,
							question: `This changes what a user sees (${seen.join(", ")}). Is this what should change?`,
							attachments: yield* shots.of(b),
						});
					}),
			});
		}),
});

const Settings = Schema.Struct({
	/** Patterns of paths a user sees. */
	seen: Schema.optional(Schema.Array(Schema.String)),
	/** Where the pictures go. */
	shots: Schema.optional(Schema.String),
});

const pack: Pack = {
	program: uiProgram,
	listens: {built: "built"},
	answers: {cleared: "cleared", raise: "raise"},
	// Without it the core ships a build before this pack's check reaches it (experiment 89's red).
	holds: true,
	layer: (settings) =>
		Schema.decodeUnknownEffect(Settings)(settings).pipe(
			Effect.mapError((error) => error.message),
			Effect.flatMap(({seen = ["\\.(tsx|jsx|css|html)$", "^src/ui/"], shots = "shots"}) =>
				Effect.try({
					try: () => seen.map((s) => new RegExp(s)),
					catch: (error) => `seen: ${String(error)}`,
				}).pipe(
					Effect.map((patterns) =>
						Layer.mergeAll(fakeShots(shots), Layer.succeed(Seen, {patterns})),
					),
				),
			),
		),
};

export default pack;
