import {checkRuns, checksAt, NONE, type Ran, type Runs} from "../check-runs.ts";
import {broke, type Law, type MsgOf, stepOf, type Update, type World, watched} from "./explore.ts";

// The local check runs under every order of runs: their world, their law, and
// the planted mistakes it must catch.
//
// It has no Cmds. Its world is the runner: a run is started for one of two
// heads, and its copy may end at that head, at the other one, or nowhere
// single (it moved while the checks ran). Each run is green or red. That is
// enough to tell "the commit asked for" from "the commit the checks saw".

export type AnyRunsMsg = MsgOf<typeof checkRuns>;
type Msg = AnyRunsMsg;
type Cmd = never;
const runsUpdate = stepOf<Runs, Msg, Cmd>(checkRuns);

const HEADS = ["A", "B"] as const;
const NAMES = ["test"] as const;

export function runsWorld(): World<Runs, Msg, Cmd> {
	return {
		outside: () =>
			HEADS.flatMap((asked) =>
				[...HEADS, null].flatMap((at) =>
					(["green", "red"] as const).map(
						(state): Msg => ({type: "ran", asked, at, results: [{name: "test", state}]}),
					),
				),
			),
		answers: () => [],
	};
}

/** How a run's results stand together: any red is red. */
const standing = (results: Ran["results"]): "green" | "red" =>
	results.some((r) => r.state === "red") ? "red" : "green";

export function runsLaws<S extends Runs>(): readonly Law<S, Msg, Cmd>[] {
	return [
		// The memory: how the last run that stood at each head went, by that head.
		watched<S, Msg, Cmd, Readonly<Record<string, "green" | "red">>>(
			"checks count only from a run at this exact head",
			{},
			(seen, {msg, next}) => {
				const now = msg.at === null ? seen : {...seen, [msg.at]: standing(msg.results)};
				for (const head of HEADS) {
					const read = checksAt(next, head, NAMES).state;
					const want = now[head] ?? "pending";
					if (read !== want)
						return broke(
							`${head} reads ${read}, and ${now[head] === undefined ? `no run stood at ${head}` : `the last run at ${head} was ${want}`}`,
						);
				}
				return now;
			},
		),
	];
}

export const runsInit: Runs = NONE;
export const runsStep: Update<Runs, Msg, Cmd> = runsUpdate;

export function showRunsMsg(m: Msg): string {
	const where = m.at === null ? "moved" : `at ${m.at}`;
	return `ran for ${m.asked}, ${where}: ${standing(m.results)}`;
}

// ---------------------------------------------------------------- planted mistakes

/** A run is filed under the commit it was asked for, not the one its copy stood at. */
export const filesUnderTheAskedHead: Update<Runs, Msg, Cmd> = (s, m) =>
	runsUpdate(s, {...m, at: m.asked});

/** A head keeps its first run: a run again at the same head is not read. */
export const firstRunWins: Update<Runs, Msg, Cmd> = (s, m) =>
	m.at !== null && s.runs.some((r) => r.at === m.at) ? [s, []] : runsUpdate(s, m);
