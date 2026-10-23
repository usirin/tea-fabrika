import type {Ask} from "@kampus/pipeline/asks/ask";
import {markOf} from "@kampus/pipeline/criteria/mark";
import type {Line, Reworded} from "@kampus/pipeline/stages/plan/lines";
import {Effect, FileSystem, Layer, Path} from "effect";
import {answersFor, type Page, whereOf} from "./pages.ts";
import {DeskView, viewFailed} from "./view.ts";

// The desk as plain markdown files in one folder: `inbox.md`, and one file per
// ask under `asks/`. Made from the pages and never read back.

type StuckCriterion = Extract<Ask, {for: "stuck"}>["criteria"][number];

const line = (l: Line) => `- **${l.key}** ${l.text}`;
const reworded = (r: Reworded) => `- **${r.key}** ${r.now} (was: ${r.was})`;
const criterion = (c: StuckCriterion) => `- ${markOf(c)} ${c.text}`;

/** The file an ask's page goes in, under the folder. */
export const fileOf = (id: string) => `asks/${id.replace(/[^A-Za-z0-9]+/g, "-")}.md`;

function askBody(page: Extract<Page, {kind: "ask"}>): readonly string[] {
	const {ask} = page;
	switch (ask.for) {
		case "plan": {
			const body = page.plan;
			if (body === null) return [];
			if (body.whole)
				return body.sections.flatMap((s) => [`## ${s.title}`, "", ...s.lines.map(line), ""]);
			return [
				`Only what changed since version ${body.approved}, which you approved. ${body.same} lines are as they were.`,
				"",
				"## New or changed",
				"",
				...(body.added.length === 0 ? ["None."] : body.added.map(line)),
				"",
				"## Said again",
				"",
				...(body.reworded.length === 0 ? ["None."] : body.reworded.map(reworded)),
				"",
				"## Gone",
				"",
				...(body.removed.length === 0 ? ["None."] : body.removed.map(line)),
				"",
			];
		}
		case "stuck":
			return [
				ask.why === "ran_out"
					? "The rounds your last answer gave are spent, and the open list is no shorter."
					: "Two review rounds in a row left the open list no shorter.",
				"",
				`Open after each round: ${ask.open.join(", ")}.`,
				"",
				"## Its criteria",
				"",
				...ask.criteria.map(criterion),
				"",
			];
		case "ruling":
			return [
				ask.ask,
				"",
				"## Options",
				"",
				...ask.options.map((o) => `- ${o}`),
				"",
				`Sent here because: ${ask.why}`,
				"",
			];
		case "check":
			return [
				ask.question,
				"",
				"## Attached",
				"",
				...(ask.attachments.length === 0
					? ["Nothing."]
					: ask.attachments.map((a) => `- [${a.label}](${a.ref})`)),
				"",
				`Asked by: ${ask.by}`,
				"",
			];
	}
}

const heading = (ask: Ask): string => {
	switch (ask.for) {
		case "plan":
			return `# Plan for ${ask.plan}, version ${ask.version}`;
		case "stuck":
			return `# Stuck: task ${ask.task} of ${ask.plan}, time ${ask.time}`;
		case "ruling":
			return `# Ruling on ${ask.ticket}`;
		case "check":
			return `# Check: build ${ask.build} of task ${ask.task} of ${ask.plan}`;
	}
};

/** A page as markdown. Pure. */
export function markdownOf(page: Page): string {
	switch (page.kind) {
		case "inbox":
			return [
				"# Waiting on the owner",
				"",
				page.rows.length === 0
					? "Nothing."
					: page.rows
							.map(
								(r, i) => `${i + 1}. [${r.for}] ${r.title} (\`${r.id}\`, [open](${fileOf(r.id)}))`,
							)
							.join("\n"),
				"",
			].join("\n");
		case "ask":
			return [
				heading(page.ask),
				"",
				...(page.refused === null
					? []
					: [`> Your last answer was not taken: ${page.refused}.`, ""]),
				...(page.ask.for === "plan" && page.ask.problems.length > 0
					? ["> The plan's Check still found:", ...page.ask.problems.map((p) => `> - ${p}`), ""]
					: []),
				...askBody(page),
				"## Answer with one of",
				"",
				...answersFor(page.ask).map((a) => `- \`${a}\``),
				"",
				`Ask: \`${page.ask.id}\`, about ${whereOf(page.ask)}`,
				"",
			].join("\n");
		case "closed":
			return [heading(page.ask), "", `Answered: ${page.said}.`, ""].join("\n");
	}
}

/** The markdown view, writing into `folder`. */
export const markdownView = (folder: string) =>
	Layer.effect(
		DeskView,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const write = (name: string, text: string) =>
				fs.makeDirectory(path.dirname(path.join(folder, name)), {recursive: true}).pipe(
					// Whole or not at all: a reader never sees half a page.
					Effect.andThen(fs.writeFileString(path.join(folder, `${name}.new`), text)),
					Effect.andThen(fs.rename(path.join(folder, `${name}.new`), path.join(folder, name))),
					Effect.mapError((error) => viewFailed(`${name}: ${error.message}`)),
				);
			return {
				show: (page: Page) =>
					write(page.kind === "inbox" ? "inbox.md" : fileOf(page.ask.id), markdownOf(page)),
			};
		}),
	);
