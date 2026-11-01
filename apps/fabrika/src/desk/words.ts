import {defineProgram, type Entry, flag, listed} from "@kampus/fabrika-old";
import {Context, Effect, Layer, Schema} from "effect";
import {TileIdSchema} from "./desk.ts";
import {type Does, SHOWS, type Show, wordOf} from "./keys.ts";

// The desk's commands as tsh words: a program for each kind, in every tile's tsh, as tmux's
// commands are what its keys are bound to. A word does what its key does, from the tile it was
// typed in (desk.ts, `typed`). `wordOf` (keys.ts) writes the word for each binding, and the
// tooltips, the palette and C-b ? show it, so no description here names a key.
//
//   tsh$ zoom                       as C-b z, on this tile
//   tsh$ split --to down            as C-b -
//   tsh$ focus --to left            as C-b h
//   tsh$ focus --to t3              as a click on t3 in the top bar's line
//   tsh$ workspace --to 2           as C-b 2; --to next, previous or new as C-b C-l, C-b C-h, C-b N
//   tsh$ close-tile                 as C-b x: asks "close t1? (y/n)" on the bottom line
//   tsh$ agents                     as C-b A: the agents' lines open under the top bar
//   tsh$ focus --to t9              tsh: focus failed: no tile t9
//
// They are the person's: a tile's tsh lists them, and the agents' socket does not (host/agents.ts),
// so no agent moves the desk you look at.

/** What a word tells the desk: the command, from this tile. The answer is why nothing was done, or `null`. */
export class DeskWords extends Context.Service<
	DeskWords,
	{readonly said: (does: Does) => string | null}
>()("@kampus/fabrika-app-old/DeskWords") {}

/** A word that named a tile or a workspace that is not there. */
interface Refused {
	readonly _tag: "refused";
	readonly message: string;
}

const tell = (does: Does) =>
	Effect.gen(function* () {
		const why = (yield* DeskWords).said(does);
		if (why !== null) return yield* Effect.fail<Refused>({_tag: "refused", message: why});
	});

/** A word with no flags: it says one command. */
const plain = (does: Does, description: string) =>
	defineProgram({name: wordOf(does), description, inputs: {}, outputs: {}, main: () => tell(does)});

const Way = Schema.Literals(["left", "down", "up", "right"]);

const split = defineProgram({
	name: "split",
	description: "Splits this tile in two. The new tile runs a fresh tsh, and is focused.",
	flags: {
		to: flag(Schema.Literals(["right", "down"]), "Where the new tile goes.", {default: "right"}),
	},
	inputs: {},
	outputs: {},
	main: ({flags}) =>
		tell({kind: "split", orientation: flags.to === "right" ? "horizontal" : "vertical"}),
});

const focus = defineProgram({
	name: "focus",
	description: "Moves focus from this tile to the next one that way, or to a tile by its name.",
	flags: {
		to: flag(Schema.Union([Way, TileIdSchema]), "A way, left, down, up or right, or a tile: t3."),
	},
	inputs: {},
	outputs: {},
	main: ({flags}) =>
		tell(Schema.is(Way)(flags.to) ? {kind: "focus", to: flags.to} : {kind: "go", tile: flags.to}),
});

/** A workspace's place in the top bar, from 1: past 9 too, where the number keys stop. */
const Place = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const Step = Schema.Literals(["new", "next", "previous"]);

const workspace = defineProgram({
	name: "workspace",
	description: "Goes to a workspace: the one in that place, the next, the previous, or a new one.",
	flags: {to: flag(Schema.Union([Step, Place]), "Its place, from 1; or next, previous or new.")},
	inputs: {},
	outputs: {},
	main: ({flags}) =>
		tell(
			flags.to === "new"
				? {kind: "new"}
				: flags.to === "next" || flags.to === "previous"
					? {kind: "step", to: flags.to}
					: {kind: "pick", at: flags.to},
		),
});

/**
 * What each word that opens a part of the frame says it does. Not `jobs`: that word is tsh's own,
 * and prints the same list in the tile, so C-b J's word is it and no second `jobs` is listed.
 */
const SHOWN: Readonly<Record<Exclude<Show, "jobs">, string>> = {
	asks: "Opens the asks list, or closes it.",
	keys: "Lists every command, with its key and its tsh word.",
	info: "Turns info mode on or off: the bottom line explains what the pointer is over.",
	bars: "Hides both bars, or shows them again.",
	agents: "Opens the agents' lines under the top bar: each agent attached to this host.",
	sync: "Opens the sync lines under the top bar: which ledger this home reads, and how.",
	host: "Opens the host's lines under the top bar: its process, its build and how long it has run.",
};

/** The words with no flags, as tsh lists them after split, focus and workspace. */
const PLAIN = [
	plain(
		{kind: "turn"},
		"Turns the container this tile is in: side by side, or one over the other.",
	),
	plain({kind: "fold"}, "Folds this tile into a strip. The last open tile does not fold."),
	plain({kind: "zoom"}, "Zooms this tile, or undoes the zoom."),
	plain({kind: "close"}, 'Asks "close t1? (y/n)" on the bottom line; y closes this tile.'),
	...SHOWS.flatMap((what) => (what === "jobs" ? [] : [plain({kind: "show", what}, SHOWN[what])])),
];

/** The desk words for one tile's tsh: each tells `said` what it does, from that tile. */
export const deskWords = (said: (does: Does) => string | null): readonly Entry[] => {
	const services = Layer.succeed(DeskWords, {said});
	return [
		listed(split, services),
		listed(focus, services),
		listed(workspace, services),
		...PLAIN.map((program) => listed(program, services)),
	];
};
