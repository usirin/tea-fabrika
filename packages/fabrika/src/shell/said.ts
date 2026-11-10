import {Effect} from "effect";
import {writerOf} from "../host/writer.ts";
import type {Said} from "./builtins.ts";
import type {Line} from "./check.ts";
import {didYouMean} from "./did-you-mean.ts";
import {runLine, type Shell} from "./execute.ts";
import {refusalLines, type SaidStatement} from "./grammar.ts";

// A said line, run: the agent named is checked against the ones summoned, and the line becomes
// one job of the `turn` program, made in code and never as text, so nothing in what is said is
// read as a shell word (docs/direction/summon-guidelines.md, S2).
//
//   @scout why does post print #7 twice? a | b &
//   // the job: turn --to scout, told prompt "why does post print #7 twice? a | b &", in the foreground
//   @Scout hi      tsh: no agent named Scout. Did you mean scout?
//   @ hi           to the one agent summoned, when there is exactly one

/** The program a said line runs as. */
const TURN = "turn";

/** Run one said line as a turn job, or refuse it in words with status 2. */
export const runSaid = (shell: Shell, st: SaidStatement): Effect.Effect<Said> =>
	Effect.gen(function* () {
		const refuse = (at: number, why: string, guess?: string): Said => {
			const lines = refusalLines(st.text, {
				kind: "refused",
				at,
				why,
				...(guess === undefined ? {} : {didYouMean: guess}),
			});
			for (const line of lines) shell.print("err", line);
			return {status: 2, exit: false};
		};
		const [mention] = st.mentions;
		if (mention === undefined) return refuse(0, "say whom to: @name, then what to say");
		// Only a person talks to an agent: an agent's tsh never starts a paid turn.
		if (writerOf(shell.by ?? "")?.kind !== "user")
			return refuse(mention.at.start - 1, "only a person talks to a summoned agent");
		const entry = shell.list.get(TURN);
		const known = (yield* shell.summons.list).map((s) => s.name);
		if (entry === undefined || known.length === 0)
			return refuse(
				mention.at.start - 1,
				"no agent is summoned here: summon <agent> as <name> starts one",
			);
		const name =
			mention.name === "" ? (known.length === 1 ? (known[0] ?? "") : null) : mention.name;
		if (name === null)
			return refuse(
				mention.at.start - 1,
				`@ alone is for the one agent summoned, and there are ${known.length}: ${known.map((n) => `@${n}`).join(" ")}`,
			);
		if (!known.includes(name)) {
			// Upper case is never folded: the lower-case name is the guess (S3).
			const lower = name.toLowerCase();
			const guess = known.includes(lower) ? lower : didYouMean(name, known);
			return refuse(mention.at.start, `no agent named ${name}`, guess);
		}
		if (st.prose.text.trim() === "")
			return refuse(st.prose.at.start, `say what to tell ${name}, after @${name}`);
		const line: Line = {
			stages: [
				{
					entry,
					flags: [{name: "to", source: {kind: "value", value: name}}],
					told: [{name: "prompt", source: {kind: "value", value: st.prose.text}}],
					wire: null,
					fed: null,
					all: false,
					text: st.text,
				},
			],
			text: st.text,
		};
		const done = yield* runLine(shell, line, {kind: "foreground", typed: st.text});
		return {status: done.status, exit: false};
	});
