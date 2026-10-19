import {
	type Book,
	criteria,
	criterionId,
	EMPTY,
	type Entry,
	standingAt,
	type Wording,
} from "../criteria/book.ts";
import {
	broke,
	type Law,
	law,
	type MsgOf,
	stepOf,
	type Update,
	type World,
	watched,
} from "./explore.ts";

// A plan's criteria book under every order of events: its world, its laws,
// and one planted mistake per law.
//
// It has no Cmds. Its world is everyone who changes criteria: the plan adds
// and rewords, the owner rewords and removes, a review adds one and judges
// any wording it was shown, at either of two commits. Two texts are enough to
// tell a reword from saying the same thing again.

export type AnyCriteriaMsg = MsgOf<typeof criteria>;
type Msg = AnyCriteriaMsg;
type Cmd = never;
const criteriaUpdate = stepOf<Book, Msg, Cmd>(criteria);

const TEXTS = ["a", "b"] as const;
const HEADS = ["A", "B"] as const;

const known = (b: Book): readonly Entry[] => [...b.live, ...b.retired];
const versionOf = (e: Entry): number => e.wordings[e.wordings.length - 1]?.version ?? 1;

export function criteriaWorld(): World<Book, Msg, Cmd> {
	return {
		outside: (b) => [
			{type: "added", task: 1, text: "a", by: "plan"},
			{type: "added", task: 2, text: "b", by: "review"},
			...known(b).flatMap((e): Msg[] => [
				...TEXTS.map((text): Msg => ({type: "reworded", id: e.id, text, by: "owner"})),
				{type: "removed", id: e.id},
				...Array.from({length: versionOf(e)}, (_, i) => i + 1).flatMap((version) =>
					HEADS.flatMap((head) =>
						(["pass", "fail"] as const).map(
							(grade): Msg => ({
								type: "judged",
								verdict: {id: e.id, version, head, grade, proof: `review at ${head}`},
							}),
						),
					),
				),
			]),
		],
		answers: () => [],
	};
}

/** Each criterion's standing at each head, as `c1@A: met v1`. */
const standings = (b: Book): ReadonlyMap<string, string> =>
	new Map(
		HEADS.flatMap((head) =>
			standingAt(b, head).map((s) => [`${s.id}@${head}`, `${s.state} v${s.version}`] as const),
		),
	);

export function criteriaLaws<S extends Book>(): readonly Law<S, Msg, Cmd>[] {
	return [
		law<S, Msg, Cmd>("an id is never given twice", ({prev, msg, next}) => {
			if (msg.type !== "added") return null;
			const fresh = next.live.filter((e) => !known(prev).some((k) => k.id === e.id));
			const was = known(prev).map((e) => e.id);
			const twice = known(next).find((e, i, all) => all.findIndex((x) => x.id === e.id) !== i);
			if (twice !== undefined) return `${twice.id} is in the book twice`;
			return fresh.length === 1
				? null
				: `an added criterion got ${fresh.map((e) => e.id).join(", ") || "no new id"}; the book had ${was.join(", ") || "none"}`;
		}),
		law<S, Msg, Cmd>(
			"an added criterion never moves another criterion's verdict",
			({prev, msg, next}) => {
				if (msg.type !== "added") return null;
				const after = standings(next);
				for (const [key, was] of standings(prev)) {
					const now = after.get(key);
					if (now !== was) return `${key} was ${was} and is ${now ?? "gone"} after an add`;
				}
				return null;
			},
		),
		watched<S, Msg, Cmd, readonly string[]>(
			"a reworded criterion is open until judged at its new version",
			[],
			(passes, {prev, msg, next}) => {
				const seen =
					msg.type === "judged" && msg.verdict.grade === "pass"
						? [
								...new Set([
									...passes,
									`${msg.verdict.id}@${msg.verdict.head} v${msg.verdict.version}`,
								]),
							].sort()
						: passes;
				if (msg.type === "reworded") {
					const before = prev.live.find((e) => e.id === msg.id);
					const said = before?.wordings[before.wordings.length - 1]?.text;
					if (before !== undefined && said !== msg.text)
						for (const head of HEADS) {
							const now = standingAt(next, head).find((s) => s.id === msg.id);
							if (now?.state === "met")
								return broke(`${msg.id} was reworded and is still met at ${head}`);
						}
				}
				for (const head of HEADS)
					for (const s of standingAt(next, head))
						if (s.state === "met" && !seen.includes(`${s.id}@${head} v${s.version}`))
							return broke(
								`${s.id} is met at ${head} v${s.version}, and no review passed that wording there`,
							);
				return seen;
			},
		),
		watched<S, Msg, Cmd, readonly string[]>(
			"a removed id never comes back",
			[],
			(retired, {msg, next}) => {
				const back = next.live.find((e) => retired.includes(e.id));
				if (back !== undefined)
					return broke(`${back.id} was removed and is live again after ${msg.type}`);
				return [...new Set([...retired, ...next.retired.map((e) => e.id)])].sort();
			},
		),
		law<S, Msg, Cmd>("every wording a criterion had is kept", ({prev, next}) => {
			for (const e of known(prev)) {
				const now = known(next).find((k) => k.id === e.id);
				if (now === undefined) return `${e.id} left the book`;
				const kept = e.wordings.every(
					(w, i) => JSON.stringify(now.wordings[i]) === JSON.stringify(w),
				);
				if (!kept)
					return `${e.id}'s wordings were ${JSON.stringify(e.wordings)} and are ${JSON.stringify(now.wordings)}`;
			}
			return null;
		}),
	];
}

export const criteriaInit: Book = EMPTY;
export const criteriaStep: Update<Book, Msg, Cmd> = criteriaUpdate;

export function showCriteriaMsg(m: Msg): string {
	switch (m.type) {
		case "added":
			return `added "${m.text}" by ${m.by}`;
		case "reworded":
			return `reworded ${m.id} to "${m.text}"`;
		case "removed":
			return `removed ${m.id}`;
		case "judged":
			return `${m.verdict.grade} ${m.verdict.id} v${m.verdict.version} at ${m.verdict.head}`;
	}
}

// ---------------------------------------------------------------- planted mistakes

/** Ids by how many criteria hold now: after a remove, the next add gets an id that was given before. */
export const reusesIds: Update<Book, Msg, Cmd> = (b, m) => {
	if (m.type !== "added") return criteriaUpdate(b, m);
	const id = criterionId(`c${b.live.length + 1}`);
	return [
		{...b, live: [...b.live, {id, task: m.task, wordings: [{version: 1, text: m.text, by: m.by}]}]},
		[],
	];
};

/**
 * Verdicts kept by place: a new criterion goes first, as a line put in at the
 * top of a plan, and every verdict stays with the place it was given at.
 */
export const keysVerdictsByPlace: Update<Book, Msg, Cmd> = (b, m) => {
	if (m.type !== "added") return criteriaUpdate(b, m);
	const [grown] = criteriaUpdate(b, m);
	const fresh = grown.live[grown.live.length - 1];
	if (fresh === undefined) return [grown, []];
	const live = [fresh, ...b.live];
	const verdicts = b.verdicts.map((v) => {
		const at = b.live.findIndex((e) => e.id === v.id);
		const moved = at === -1 ? undefined : live[at];
		return moved === undefined ? v : {...v, id: moved.id};
	});
	return [{...grown, live, verdicts}, []];
};

/** A reword changes the words in place: no new version, so a pass of the old words still counts. */
export const rewordKeepsVersion: Update<Book, Msg, Cmd> = (b, m) => {
	if (m.type !== "reworded") return criteriaUpdate(b, m);
	return [
		{
			...b,
			live: b.live.map((e) => {
				if (e.id !== m.id) return e;
				const last = e.wordings.length - 1;
				const swap = (w: Wording, i: number): Wording => (i === last ? {...w, text: m.text} : w);
				const [first, ...rest] = e.wordings;
				return {...e, wordings: [swap(first, 0), ...rest.map((w, i) => swap(w, i + 1))]};
			}),
		},
		[],
	];
};

/** A pass of an older wording is taken for the current one. */
export const passCarriesOver: Update<Book, Msg, Cmd> = (b, m) => {
	if (m.type !== "judged") return criteriaUpdate(b, m);
	const entry = b.live.find((e) => e.id === m.verdict.id);
	return criteriaUpdate(
		b,
		entry === undefined ? m : {...m, verdict: {...m.verdict, version: versionOf(entry)}},
	);
};

/** A reword of a removed criterion brings it back. */
export const rewordRevives: Update<Book, Msg, Cmd> = (b, m) => {
	const gone = m.type === "reworded" ? b.retired.find((e) => e.id === m.id) : undefined;
	if (gone === undefined) return criteriaUpdate(b, m);
	return criteriaUpdate(
		{...b, live: [...b.live, gone], retired: b.retired.filter((e) => e !== gone)},
		m,
	);
};
