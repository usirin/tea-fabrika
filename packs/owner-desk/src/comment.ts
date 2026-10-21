import {type Ask, titleOf} from "@kampus/fabrika/pipeline/asks/ask";
import {markOf} from "@kampus/fabrika/pipeline/criteria/mark";
import type {Line} from "@kampus/fabrika/pipeline/stages/plan/lines";
import {Effect, FileSystem, Layer, Path, Schema} from "effect";
import {answersFor, type Page, whereOf} from "./pages.ts";
import {DeskView, viewFailed} from "./view.ts";

// The desk as GitHub comments, with a stand-in for GitHub: one comment per
// ask on the ticket it is about, and the inbox as one comment on a "desk"
// thread. A comment is found again by a hidden marker and edited in place, as
// a bot edits its own comment. The stand-in keeps each thread's comments in a
// JSON file in one folder, so a test can read what GitHub would show.
//
// It is a second view of the same pages (./markdown.ts is the first): the
// desk program and the core are the same either way.

export const Comment = Schema.Struct({marker: Schema.String, body: Schema.String});
export type Comment = typeof Comment.Type;
const Thread = Schema.Array(Comment);

/** The thread the inbox is posted on. */
export const DESK = "desk";

/** The file a thread's comments are kept in, under the folder. */
export const threadFile = (where: string) => `${where.replace(/[^A-Za-z0-9]+/g, "-")}.json`;

/** The hidden marker a comment is found by. */
export const markerOf = (id: string) => `<!-- owner-desk:${id} -->`;

type StuckCriterion = Extract<Ask, {for: "stuck"}>["criteria"][number];

const item = (l: Line) => `- [ ] \`${l.key}\` ${l.text}`;
const criterion = (c: StuckCriterion) => `- [ ] ${markOf(c)} ${c.text}`;
const fold = (summary: string, lines: readonly string[]) =>
	lines.length === 0
		? []
		: ["<details>", `<summary>${summary}</summary>`, "", ...lines, "", "</details>"];

/** A page as a comment body: GitHub-flavoured, with the marker first. Pure. */
export function commentOf(page: Page): string {
	if (page.kind === "inbox")
		return [
			markerOf("inbox"),
			`**${page.rows.length} waiting on the owner**, oldest first:`,
			"",
			...page.rows.map((r) => `- [ ] ${r.title} (\`${r.id}\`)`),
		].join("\n");
	if (page.kind === "closed")
		return [
			markerOf(page.ask.id),
			`~~${titleOf(page.ask)}~~`,
			"",
			`**Answered:** ${page.said}.`,
		].join("\n");
	const {ask} = page;
	const lead = [
		markerOf(ask.id),
		`**${titleOf(ask)}**`,
		...(page.refused === null
			? []
			: ["", `> [!WARNING]\n> Your last answer was not taken: ${page.refused}.`]),
	];
	const reply = [
		"",
		`Reply with one of: ${answersFor(ask)
			.map((a) => `\`${a}\``)
			.join(" · ")}`,
	];
	switch (ask.for) {
		case "plan": {
			const body = page.plan;
			if (body === null) return [...lead, ...reply].join("\n");
			const shown = body.whole
				? body.sections.flatMap((s) => fold(`${s.title} (${s.lines.length})`, s.lines.map(item)))
				: [
						`Changed since v${body.approved}, which you approved (${body.same} lines unchanged, not shown):`,
						"",
						...body.added.map((l) => `- [ ] \`${l.key}\` **new or changed:** ${l.text}`),
						...body.reworded.map((r) => `- [ ] \`${r.key}\` **said again:** ${r.now} ~~${r.was}~~`),
						...body.removed.map((l) => `- ~~\`${l.key}\` ${l.text}~~`),
					];
			const problems =
				ask.problems.length === 0
					? []
					: [
							"",
							"> [!NOTE]\n> The plan's Check still found:",
							...ask.problems.map((p) => `> - ${p}`),
						];
			return [...lead, ...problems, "", ...shown, ...reply].join("\n");
		}
		case "stuck":
			return [
				...lead,
				"",
				`Open after each round: ${ask.open.join(" → ")} (${ask.why === "ran_out" ? "the rounds you gave are spent" : "two rounds without progress"}).`,
				"",
				...fold(`Criteria (${ask.criteria.length})`, ask.criteria.map(criterion)),
				...reply,
			].join("\n");
		case "ruling":
			return [
				...lead,
				"",
				ask.ask,
				"",
				...ask.options.map((o) => `- ${o}`),
				"",
				`_Why it is yours: ${ask.why}_`,
				...reply,
			].join("\n");
		case "check":
			return [
				...lead,
				"",
				ask.question,
				"",
				// GitHub shows a picture inline; anything else is a link.
				...ask.attachments.map((a) =>
					/\.(png|jpe?g|gif|webp)$/i.test(a.ref)
						? `![${a.label}](${a.ref})`
						: `[${a.label}](${a.ref})`,
				),
				"",
				`_Asked by ${ask.by}_`,
				...reply,
			].join("\n");
	}
}

/** The GitHub-comment view, with its stand-in keeping each thread in `folder`. */
export const commentView = (folder: string) =>
	Layer.effect(
		DeskView,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Thread));
			const post = (where: string, marker: string, body: string) =>
				Effect.gen(function* () {
					const file = path.join(folder, threadFile(where));
					const there = yield* fs.exists(file);
					const thread = there ? yield* decode(yield* fs.readFileString(file)) : [];
					const at = thread.findIndex((c) => c.marker === marker);
					const next =
						at === -1
							? [...thread, {marker, body}]
							: thread.map((c, i) => (i === at ? {marker, body} : c));
					yield* fs.makeDirectory(folder, {recursive: true});
					// Whole or not at all, as GitHub shows a comment: a reader never sees half a thread.
					yield* fs.writeFileString(`${file}.new`, `${JSON.stringify(next, null, "\t")}\n`);
					yield* fs.rename(`${file}.new`, file);
				}).pipe(Effect.mapError((error) => viewFailed(`${where}: ${error.message}`)));
			return {
				show: (page: Page) =>
					page.kind === "inbox"
						? post(DESK, markerOf("inbox"), commentOf(page))
						: post(whereOf(page.ask), markerOf(page.ask.id), commentOf(page)),
			};
		}),
	);

/** Every comment the stand-in keeps on one thread, for a test to read. */
export const threadOf = (folder: string, where: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const file = path.join(folder, threadFile(where));
		if (!(yield* fs.exists(file))) return [];
		return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Thread))(
			yield* fs.readFileString(file),
		);
	});
