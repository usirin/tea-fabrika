import {chmodSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {Thread} from "./combos.ts";
import {isMachines, issueThread} from "./operator-live.ts";

// The thread a person answers on, over a stand-in `gh` that keeps an issue's
// comments in a file. The operator's tests ask and listen on a thread in
// memory; these are the live Layer's own rules: a question is posted once
// however many runs ask it, and a reply is a later comment no machine marked.

const ISSUE = "https://github.com/example/repo/issues/7";

interface Comment {
	readonly id: number;
	readonly created_at: string;
	readonly body: string;
	readonly user: {readonly login: string};
}

function standIn() {
	const dir = mkdtempSync(join(tmpdir(), "issue-thread-"));
	const file = join(dir, "comments.json");
	const gh = join(dir, "gh");
	writeFileSync(file, "[]");
	writeFileSync(
		gh,
		[
			"#!/usr/bin/env node",
			'const fs = require("node:fs"), path = require("node:path");',
			'const file = path.join(__dirname, "comments.json");',
			'const all = JSON.parse(fs.readFileSync(file, "utf8"));',
			"const args = process.argv.slice(2);",
			'fs.appendFileSync(path.join(__dirname, "calls.log"), args.slice(0, 2).join(" ") + "\\n");',
			// `gh api --paginate --slurp <path>`: every page, as a list of pages.
			'if (args[0] === "api") process.stdout.write(JSON.stringify([all]));',
			// `gh issue comment <url> --body <text>`: one more comment, a second after the last.
			'else if (args[0] === "issue" && args[1] === "comment") {',
			"  const id = all.length + 1;",
			'  const html_url = args[2] + "#issuecomment-" + id;',
			'  all.push({ id, html_url, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(), body: args[args.indexOf("--body") + 1], user: { login: "owner" } });',
			"  fs.writeFileSync(file, JSON.stringify(all));",
			"} else process.exit(1);",
		].join("\n"),
	);
	chmodSync(gh, 0o755);
	/** What the Layer told its log about each question. */
	const logged: (readonly [string, boolean])[] = [];
	const layer = issueThread({pollMs: 5, gh, posted: (link, found) => logged.push([link, found])});
	const use = <A, E>(f: (thread: Thread["Service"]) => Effect.Effect<A, E>) =>
		Effect.runPromise(
			Effect.gen(function* () {
				return yield* f(yield* Thread);
			}).pipe(Effect.provide(layer)),
		);
	const read = () => JSON.parse(readFileSync(file, "utf8")) as Comment[];
	/** Someone comments, a second after the last comment. */
	const says = (login: string, body: string) => {
		const all = read();
		const id = all.length + 1;
		writeFileSync(
			file,
			JSON.stringify([
				...all,
				{
					id,
					created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(),
					body,
					user: {login},
				},
			]),
		);
	};
	const calls = () => readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n");
	return {use, read, says, calls, logged};
}

describe("the thread on an issue's comments", () => {
	it("posts a question once: a second run that asks it finds it on the issue, and is told when it was posted", async () => {
		const gh = standIn();
		gh.says("owner", "<!-- fabrika-triage-claim session=s lane=l -->");
		const ask = {where: ISSUE, text: "The lane stopped. Carry on?", intent: "7/issue/ask/4"};

		const first = await gh.use((t) => t.post(ask));
		const again = await gh.use((t) => t.post(ask));

		expect(gh.read().map((c) => c.body)).toEqual([
			"<!-- fabrika-triage-claim session=s lane=l -->",
			"The lane stopped. Carry on?\n\n<!-- tea-fabrika 7/issue/ask/4 -->",
		]);
		expect(first).toEqual({thread: ISSUE, at: Date.UTC(2026, 0, 1, 0, 0, 2)});
		expect(again).toEqual(first);
		expect(gh.calls().filter((c) => c === "issue comment")).toHaveLength(1);
		// The log hears the question's link both times, and which run posted it.
		expect(gh.logged).toEqual([
			[`${ISSUE}#issuecomment-2`, false],
			[`${ISSUE}#issuecomment-2`, true],
		]);

		// Another park of the same lane is another question, and `ask/4` is not found inside `ask/40`.
		await gh.use((t) => t.post({...ask, intent: "7/issue/ask/40"}));
		await gh.use((t) => t.post(ask));
		expect(gh.read()).toHaveLength(3);
	});

	it("hands on the comments since the question that no machine marked, whoever wrote them", async () => {
		const gh = standIn();
		gh.says("owner", "an older comment, from before the question");
		const {thread, at} = await gh.use((t) =>
			t.post({where: ISSUE, text: "Carry on?", intent: "7/issue/ask/4"}),
		);
		// The next run's own claim, as fabrika 0.9.0 posts it: under the owner's account, with no hidden mark.
		gh.says(
			"owner",
			"lane-claim: lane:run-2:11111111-2222-4333-8444-555555555555 · 2026-01-01T00:00:03.000Z",
		);
		gh.says("stranger", "what is this?");
		gh.says("Second", "I approved it, carry on");

		const replies = await gh.use((t) =>
			t.replies(thread, at).pipe(Stream.take(2), Stream.runCollect, Effect.timeout("2 seconds")),
		);

		expect([...replies]).toEqual([
			{id: "4", author: "stranger", body: "what is this?", at: Date.UTC(2026, 0, 1, 0, 0, 4)},
			{
				id: "5",
				author: "Second",
				body: "I approved it, carry on",
				at: Date.UTC(2026, 0, 1, 0, 0, 5),
			},
		]);
		// A later listener, from the last reply it read, starts after it.
		gh.says("owner", "one more");
		const later = await gh.use((t) =>
			t
				.replies(thread, Date.UTC(2026, 0, 1, 0, 0, 5))
				.pipe(Stream.take(1), Stream.runCollect, Effect.timeout("2 seconds")),
		);
		expect([...later].map((r) => r.body)).toEqual(["one more"]);
	});

	it("takes fabrika's own records for a machine's, marked or not, and a person's words for a person's", () => {
		for (const body of [
			"<!-- fabrika-triage-claim session=s lane=l -->",
			"Carry on?\n\n<!-- tea-fabrika 7/issue/ask/4 -->",
			"lane-claim: lane:run-2:11111111 · 2026-01-01T00:00:03.000Z",
			"lane-adopt: run-1 by lane:run-2:11111111 · 2026-01-01T00:00:03.000Z · reason: dead",
			"build-claim: build:s:u · 2026-01-01T00:00:03.000Z\nbuild-claim-override: 7 · repair",
			"lane-record: #7 complete @ 2026-01-01T00:00:09.000Z\n\n| Field | Value |",
		]) {
			expect([body, isMachines(body)]).toEqual([body, true]);
		}
		for (const body of [
			"/resume",
			"approved, carry on",
			"the lane-claim: line above is the machine's, right?",
			"build it again",
		]) {
			expect([body, isMachines(body)]).toEqual([body, false]);
		}
	});
});
