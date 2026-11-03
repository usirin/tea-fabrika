import {createHash} from "node:crypto";
import {Effect, FileSystem, Path} from "effect";

// A step's brief is one plain file a program loads, kept apart from its logic, so changing a brief
// never changes code:
//
//   ---
//   step: plan
//   slots:
//     ticket: the ticket's title and body, fenced
//   ---
//   You write the plan for one ticket. {ticket}
//
//   const brief = parseBrief("plan.md", text);   // {name: "plan.md", hash: "3f1c...", slots: ["ticket"], body}
//   fill(brief, {ticket: "fix the slug"});       // "You write the plan for one ticket. fix the slug"
//
// Each run writes the name and the hash on its `started` fact, as it starts: that is lost forever
// if it is not written then, and it is what lets two briefs be compared later.

export interface Brief {
	readonly name: string;
	/** The hash of the whole file, as it is on disk. */
	readonly hash: string;
	readonly slots: readonly string[];
	readonly body: string;
}

export const hashOfBrief = (text: string): string =>
	createHash("sha256").update(text).digest("hex").slice(0, 16);

/** A brief file's parts. Pure. A file with no frontmatter has no slots. */
export const parseBrief = (name: string, text: string): Brief => {
	const head = /^---\n([\s\S]*?)\n---\n/.exec(text);
	const front = head?.[1] ?? "";
	const open = front.split("\n");
	const from = open.indexOf("slots:");
	const slots =
		from < 0
			? []
			: open.slice(from + 1).flatMap((line) => {
					const slot = /^ {2}([a-z_]+):/.exec(line);
					return slot === null ? [] : [slot[1] as string];
				});
	return {
		name,
		hash: hashOfBrief(text),
		slots,
		body: (head === null ? text : text.slice(head[0].length)).trim(),
	};
};

/**
 * The brief with each `{slot}` filled, in one pass, so a slot's own value is never read as another
 * slot. A slot a step did not give is left out, and says so. Text the file holds in braces that is
 * no slot stays as it is. Pure.
 */
export const fill = (brief: Brief, values: Readonly<Record<string, string>>): string =>
	brief.body.replace(/\{([a-z_]+)\}/g, (whole, slot: string) =>
		brief.slots.includes(slot) ? (values[slot] ?? "(none)") : whole,
	);

/** A text in a code fence longer than any run of backticks inside it. Pure. */
export const fenced = (text: string, word = ""): string => {
	const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
	const fence = "`".repeat(longest + 1);
	return `${fence}${word}\n${text.replace(/\n+$/, "")}\n${fence}`;
};

/** One item per line, or `empty`. Pure. */
export const listed = (lines: readonly string[], empty = "None."): string =>
	lines.length === 0 ? empty : lines.map((line) => `- ${line}`).join("\n");

/** A brief file, read from `folder` fresh for each run: it may have changed since the last. */
export const loadBrief = (folder: string, name: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		return parseBrief(name, yield* fs.readFileString(path.join(folder, name)));
	});
