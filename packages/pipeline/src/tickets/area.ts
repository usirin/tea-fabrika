import {type Row, Writer, type Writes, writerOf} from "@kampus/fabrika-old";
import {Option, Schema, SchemaTransformation} from "effect";
import type {Ticket} from "./ticket.ts";

// The project's areas (docs/direction/areas.md): a person's data on the ledger, on one stream of
// their own, `tracker/areas`. A person makes, renames and merges them. A ticket holds an area's
// number, so a rename touches no ticket and a merge moves every ticket at once. The program holds
// no list of areas: every name is folded from the stream. This file is pure; the tracker's
// ledger.ts reads and writes the stream.
//
//   tracker/areas/inbox  {_tag: "area_made", area: 1, name: "pipeline", suggested: {_tag: "titles", word: "lane", tickets: 21}}
//                        {_tag: "area_made", area: 2, name: "lane"}
//                        {_tag: "area_merged", area: 2, into: 1}
//
//   areasOf(entries)     {areas: {live: {1: "pipeline"}, into: {2: 1}}, problems: []}
//   liveOf(areas, 2)     1
//
// The app suggests areas and never makes one (`suggestionsOf`): a person ticks a suggestion, and
// the fact keeps what they were shown, as `suggested`.

/** An area's number: 1, 2, 3, in the order the areas were made. */
export const AreaNumber = Schema.Int.check(Schema.isGreaterThan(0));
export type AreaNumber = typeof AreaNumber.Type;

/** An area's name: 1 to 32 characters, with no space at either end. */
export const AreaName = Schema.String.check(
	Schema.isTrimmed(),
	Schema.isMinLength(1),
	Schema.isMaxLength(32),
);

/** What the app suggested, when an area came from a suggestion: what the person saw and took. */
export const Suggested = Schema.TaggedUnion({
	/** A top folder of a connected repository, such as `apps/fabrika`. */
	folder: {path: Schema.String},
	/** The first word before a colon that `tickets` open titles share, in lower case. */
	titles: {word: Schema.String, tickets: Schema.Int},
});
export type Suggested = typeof Suggested.Type;

/** What happened to the project's areas. A person writes all three. */
export const AreaFact = Schema.TaggedUnion({
	area_made: {area: AreaNumber, name: AreaName, suggested: Schema.optionalKey(Suggested)},
	area_renamed: {area: AreaNumber, name: AreaName},
	area_merged: {area: AreaNumber, into: AreaNumber},
});
export type AreaFact = typeof AreaFact.Type;

/** The areas' registered name. Its facts go to the name's inbox. */
export const AREAS = "tracker/areas";

/**
 * Who may write each area fact: a person only. The type holds this table to the door's
 * `PERSON_KINDS`, so the door refuses each from an agent's session.
 */
const WRITTEN_BY = {
	area_made: "person",
	area_renamed: "person",
	area_merged: "person",
} as const satisfies Writes<AreaFact["_tag"]>;

/** May `by` write this area fact: only a user, since every one is a person's. */
const mayWriteArea = (by: Writer, tag: AreaFact["_tag"]): boolean =>
	WRITTEN_BY[tag] !== "person" || by.kind === "user";

/** One area fact read back: who wrote it, when, and where the ledger put it. */
export const AreaEntry = Schema.Struct({
	pos: Schema.Int,
	by: Writer,
	at: Schema.Finite,
	fact: AreaFact,
});
export type AreaEntry = typeof AreaEntry.Type;

/** A map kept as its pairs, so it saves as JSON and loads back a map. */
const MapOf = <K, V>(key: Schema.Codec<K>, value: Schema.Codec<V>) =>
	Schema.Array(Schema.Tuple([key, value])).pipe(
		Schema.decodeTo(
			Schema.ReadonlyMap(key, value),
			SchemaTransformation.transform({
				decode: (pairs): ReadonlyMap<K, V> => new Map(pairs),
				encode: (map) => [...map],
			}),
		),
	);

/** The areas, folded: the live ones by number, and where each merged one went. */
export const Areas = Schema.Struct({
	live: MapOf(AreaNumber, AreaName),
	into: MapOf(AreaNumber, AreaNumber),
});
export type Areas = typeof Areas.Type;

export const NO_AREAS: Areas = {live: new Map(), into: new Map()};

/** The number the next `area_made` takes: one past every area made so far, merged or not. */
export const nextArea = (areas: Areas): AreaNumber => areas.live.size + areas.into.size + 1;

/** The live area that has `name`, ignoring case, other than `but`; `null`: none has it. */
const holderOf = (areas: Areas, name: string, but?: AreaNumber): string | null => {
	const wanted = name.toLowerCase();

	for (const [n, other] of areas.live) {
		if (n !== but && other.toLowerCase() === wanted) {
			return other;
		}
	}

	return null;
};

/** Why a name cannot be an area's, beside the live areas; `null`: it can. */
export const nameRefused = (areas: Areas, name: string, but?: AreaNumber): string | null => {
	if (!Schema.is(AreaName)(name)) {
		return "an area's name is 1 to 32 characters, with no space at either end";
	}

	const holder = holderOf(areas, name, but);
	return holder === null ? null : `the area "${holder}" has that name already`;
};

/** Why `fact` does not fit `areas`; `null`: it fits. */
export const areaRefused = (areas: Areas, fact: AreaFact): string | null => {
	switch (fact._tag) {
		case "area_made": {
			const next = nextArea(areas);

			if (fact.area !== next) {
				return `area ${fact.area} made, but the next number is ${next}`;
			}

			return nameRefused(areas, fact.name);
		}
		case "area_renamed":
			if (!areas.live.has(fact.area)) {
				return `a rename of area ${fact.area}, which is not live`;
			}

			return nameRefused(areas, fact.name, fact.area);
		case "area_merged":
			if (fact.area === fact.into) {
				return `area ${fact.area} merged into itself`;
			}

			if (!areas.live.has(fact.area)) {
				return `a merge of area ${fact.area}, which is not live`;
			}

			return areas.live.has(fact.into) ? null : `a merge into area ${fact.into}, which is not live`;
	}
};

/** `areas` after `fact`, which fits. */
const after = (areas: Areas, fact: AreaFact): Areas => {
	switch (fact._tag) {
		case "area_made":
		case "area_renamed":
			return {...areas, live: new Map(areas.live).set(fact.area, fact.name)};
		case "area_merged": {
			const live = new Map(areas.live);
			live.delete(fact.area);
			return {live, into: new Map(areas.into).set(fact.area, fact.into)};
		}
	}
};

/**
 * `areas` after one fact, or why it does not fit: the step `areasOf` takes for each row, and the
 * one a writer takes for its own fact once the ledger has it (read your own writes).
 */
export const areaAfter = (
	areas: Areas,
	fact: AreaFact,
): {readonly areas: Areas} | {readonly why: string} => {
	const why = areaRefused(areas, fact);
	return why === null ? {areas: after(areas, fact)} : {why};
};

/**
 * Fold area entries, in the ledger's order, onto `from`: the areas after them, and what did not
 * fit, in words, one problem each. A merged area's old name is free again; a merge into a merged
 * area is refused, so `into` never closes a loop.
 */
export const areasOf = (
	entries: readonly AreaEntry[],
	from: Areas = NO_AREAS,
): {readonly areas: Areas; readonly problems: readonly string[]} => {
	let areas = from;
	const problems: string[] = [];

	for (const {pos, by, fact} of entries) {
		const step = mayWriteArea(by, fact._tag)
			? areaAfter(areas, fact)
			: {why: `${fact._tag} written by an agent, but only a person writes it`};

		if ("areas" in step) {
			areas = step.areas;
		} else {
			problems.push(`row ${pos} on the areas: ${step.why}`);
		}
	}

	return {areas, problems};
};

/** The live area `n` reads as: itself, or where its merges went, followed to the end. */
export const liveOf = (areas: Areas, n: AreaNumber): AreaNumber => {
	let at = n;

	for (let next = areas.into.get(at); next !== undefined; next = areas.into.get(at)) {
		at = next;
	}

	return at;
};

const decodeFact = Schema.decodeUnknownOption(Schema.fromJsonString(AreaFact));
const AREAS_INBOX = `${AREAS}/inbox`;

/** What one ledger row is to the areas: one of their facts, a row of another stream, or broken. */
export const AreaRead = Schema.TaggedUnion({
	entry: {entry: AreaEntry},
	other: {},
	broken: {why: Schema.String},
});
export type AreaRead = typeof AreaRead.Type;

/** Read one row. A row on the areas' inbox must hold an area fact, kept under its own tag. */
export const readAreaRow = (row: Row): AreaRead => {
	if (row.stream !== AREAS_INBOX) {
		return AreaRead.cases.other.make({});
	}

	const broken = (why: string) =>
		AreaRead.cases.broken.make({why: `row ${row.pos} on the areas: ${why}`});
	const by = writerOf(row.writer);

	if (by === null) {
		return broken(`its writer "${row.writer}" is neither a user nor an agent`);
	}

	const fact = Option.getOrNull(decodeFact(row.data));

	if (fact === null) {
		return broken("its data is not an area fact");
	}

	if (fact._tag !== row.kind) {
		return broken(`an ${fact._tag} fact kept as ${row.kind}`);
	}

	return AreaRead.cases.entry.make({entry: {pos: row.pos, by, at: row.at, fact}});
};

// ---------------------------------------------------------------- suggestions, never facts

/** The fewest open titles a word must start for it to be suggested. */
const TITLES_FEWEST = 3;

/** A title's first word before a colon, in lower case: "Lane tests: ..." is `lane`. `null`: no colon. */
const wordOf = (title: string): string | null => {
	const colon = title.indexOf(":");

	if (colon === -1) {
		return null;
	}

	const word = title.slice(0, colon).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
	return word === "" ? null : word;
};

/** The name a suggestion makes, when a person ticks it: the word, or the folder's last part. */
export const suggestedName = (s: Suggested): string =>
	s._tag === "titles" ? s.word : (s.path.split("/").filter(Boolean).at(-1) ?? s.path);

/**
 * What the app suggests a person makes their first areas from. Each first word before a colon
 * that three or more open titles share, with how many share it, most first; then each folder, in
 * the order given. A suggestion whose name `AreaName` refuses (over 32 characters, or with a space
 * at an end) is left out, since ticking it could make no area; so is one whose name a live area
 * has, or an earlier suggestion's, ignoring case. Pure.
 *
 *   suggestionsOf([{title: "Lane: a run hangs", ...} x3], ["apps/fabrika"], NO_AREAS)
 *   // [{_tag: "titles", word: "lane", tickets: 3}, {_tag: "folder", path: "apps/fabrika"}]
 */
export const suggestionsOf = (
	tickets: readonly Ticket[],
	folders: readonly string[],
	areas: Areas,
): readonly Suggested[] => {
	const counts = new Map<string, number>();

	for (const t of tickets) {
		const word = t.state === "open" ? wordOf(t.title) : null;

		if (word !== null) {
			counts.set(word, (counts.get(word) ?? 0) + 1);
		}
	}

	const words = [...counts]
		.filter(([, n]) => n >= TITLES_FEWEST)
		.sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
		.map(([word, n]): Suggested => ({_tag: "titles", word, tickets: n}));
	const all = [...words, ...folders.map((path): Suggested => ({_tag: "folder", path}))];
	const taken = new Set([...areas.live.values()].map((n) => n.toLowerCase()));
	return all.filter((s) => {
		const name = suggestedName(s);

		if (!Schema.is(AreaName)(name)) {
			return false;
		}

		const key = name.toLowerCase();

		if (taken.has(key)) {
			return false;
		}

		taken.add(key);
		return true;
	});
};
