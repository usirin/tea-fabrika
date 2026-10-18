import {Effect, Layer} from "effect";
import {noRun} from "../review/reviewer";
import {type BuildBrief, type BuildDrafted, Builder, type Built} from "./form";

// A builder that runs no agent: a script says how each run ends. For tests,
// and for a run that proves the wiring without paying for an agent. Each
// brief it was handed is kept, in order, so a test reads what the machine
// told it.

/** A form that says it did the work and ran nothing. */
export const builtBy = (summary: string): Built => ({summary, deviations: [], ran: [], left: []});

export function scriptedBuilder(
	script: (brief: BuildBrief, at: number) => BuildDrafted | Effect.Effect<BuildDrafted>,
) {
	const briefs: BuildBrief[] = [];
	const layer = Layer.succeed(Builder, {
		build: (brief) =>
			Effect.suspend(() => {
				briefs.push(brief);
				const said = script(brief, briefs.length);
				return Effect.isEffect(said) ? said : Effect.succeed(said);
			}),
	});
	return {layer, briefs};
}

/** A run that hands back `built`, at no cost. */
export const built = (form: Built): BuildDrafted => ({answer: "built", built: form, ...noRun});
