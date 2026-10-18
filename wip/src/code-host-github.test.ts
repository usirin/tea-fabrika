import {readFileSync} from "node:fs";
import {run} from "@demlik/tea/effect";
import {Effect, Layer, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {
	type Accounts,
	type Gh,
	kindsNeeded,
	parseJsonc,
	prOf,
	readPrFacts,
	rulesOf,
	textKindOf,
	ticketIn,
	ticketOf,
	verdictsAt,
} from "./code-host-github.ts";
import {CodeHost} from "./services.ts";
import type {ReviewKind, ShipFacts} from "./stages/ship/facts.ts";
import {shipReadInterpret} from "./stages/ship/handlers.ts";
import {look} from "./stages/ship/look.ts";
import {readShipFacts, type ShipMsg, ship} from "./stages/ship/machine.ts";

// `CodeHost` on GitHub, against recorded answers of `gh api graphql`. The
// files under `fixtures/code-host/` were made from real public pull requests
// and trimmed: account names and the owning team replaced, bodies cut to the
// lines that are read, file lists cut to the files that decide something, and
// the two config files cut to the keys that are read. No call leaves this
// file.
//
// One of them is not as recorded. Neither repo had a pull request with an
// unresolved review thread, so `open-person-comment.json` is the clean one
// with another's resolved thread put in, set unresolved, and a person's reply
// added.

const PR = "https://github.com/example/repo/pull/7";
/** The repo's two owners. Both open pull requests, and both post review verdicts. */
const OWNERS = ["repo-owner", "second-owner"];
const WHO: Accounts = {own: OWNERS, reviewers: OWNERS};
const recorded = (name: string): string =>
	readFileSync(new URL(`../../fixtures/code-host/${name}.json`, import.meta.url), "utf8");

type Answers = {
	readonly pr: string | "breaks";
	readonly team?: string | "breaks";
	readonly base?: string;
};

/**
 * A `gh` that answers the reader's three calls from recorded text, and keeps
 * the calls: where the pull request stands (made from the recorded answer's
 * own head), the pull request, and a team's members.
 */
function fakeGh(answers: Answers) {
	const calls: (readonly string[])[] = [];
	const gh: Gh = (args) => {
		calls.push(args);
		const has = (field: string) => args.some((arg) => arg.startsWith(`${field}=`));
		const answer = has("team") ? (answers.team ?? recorded("team")) : answers.pr;
		if (answer === "breaks") return Effect.fail({_tag: "unknown" as const});
		if (has("team") || has("codeowners")) return Effect.succeed(answer);
		// The first call. An answer that is not the recorded shape is handed on as it is, to fail where it would.
		return Effect.try({
			try: (): unknown => JSON.parse(answer).data.repository.pullRequest.headRefOid,
			catch: () => answer,
		}).pipe(
			Effect.match({
				onFailure: (asItIs) => asItIs,
				onSuccess: (head) =>
					JSON.stringify({
						data: {
							repository: {pullRequest: {headRefOid: head, baseRefName: answers.base ?? "main"}},
						},
					}),
			}),
		);
	};
	return {gh, calls};
}
const factsOn = (pr: string, who = WHO, team?: string | "breaks") =>
	Effect.runPromise(readPrFacts(fakeGh(team === undefined ? {pr} : {pr, team}).gh, who)(PR));
const failureOn = (pr: string | "breaks") =>
	Effect.runPromise(Effect.flip(readPrFacts(fakeGh({pr}).gh, WHO)(PR)));
/** A `CodeHost` that only reads facts: its two waits never say anything. */
const hostOf = (prFacts: (pr: string) => Effect.Effect<ShipFacts, {readonly _tag: "unknown"}>) =>
	Layer.succeed(CodeHost, {
		prFacts,
		change: () => Effect.fail({_tag: "unknown" as const}),
		checksSettled: () => Stream.never,
		leftQueue: () => Stream.never,
	});
/** The whole way: the service on a recorded answer, the real handler, the real machine up to its first write. */
const lookOn = (pr: string | "breaks") =>
	Effect.runPromise(look(PR).pipe(Effect.provide(hostOf(readPrFacts(fakeGh({pr}).gh, WHO)))));

/** A recorded answer with something changed: `repo` holds the three files, `pr` the pull request. */
function changed(
	name: string,
	change: (pr: Record<string, any>, repo: Record<string, any>) => void,
): string {
	const answer = JSON.parse(recorded(name));
	change(answer.data.repository.pullRequest, answer.data.repository);
	return JSON.stringify(answer);
}
function changedTeam(change: (members: Record<string, any>) => void): string {
	const answer = JSON.parse(recorded("team"));
	change(answer.data.organization.team.members);
	return JSON.stringify(answer);
}

const kinds = (list: Readonly<Record<string, ReviewKind["verdict"]>>) =>
	Object.entries(list).map(([kind, verdict]) => ({kind, verdict}));

describe("the facts of a recorded pull request", () => {
	it.each<[string, Omit<ShipFacts, "reviewKinds"> & {reviewKinds: unknown}]>([
		[
			"merged",
			{
				head: "b22ac7cd48f740d4eb54f7c2ec1d4c5e7e85b0bf",
				state: "merged",
				ours: true,
				ticket: "closes_it",
				approval: "not_needed",
				reviews: "passed",
				reviewKinds: kinds({"review-doc": "passed"}),
				checks: "green",
				mergeable: "unknown",
				comments: [],
			},
		],
		[
			// It changed a workflow file, and the other owner approved its head.
			"merged-approved",
			{
				head: "7779cf9be905f5c1b0c51a991f3a1a199e78b96e",
				state: "merged",
				ours: true,
				ticket: "closes_it",
				approval: "given",
				reviews: "passed",
				reviewKinds: kinds({"review-code": "passed", governance: "passed"}),
				checks: "green",
				mergeable: "unknown",
				comments: [],
			},
		],
		[
			// Two kinds of review needed, both passed, no protected file.
			"open-clean",
			{
				head: "9eb6b52c75d64b555547780717bd43a2460bb658",
				state: "open",
				ours: true,
				ticket: "closes_it",
				approval: "not_needed",
				reviews: "passed",
				reviewKinds: kinds({"review-code": "passed", "review-doc": "passed"}),
				checks: "green",
				mergeable: "clean",
				comments: [],
			},
		],
		[
			// Every review passed. It changed a workflow file and no owner has approved.
			"open-awaiting-approval",
			{
				head: "7c80607bd0e3131830e7e6afab7844125185e2f6",
				state: "open",
				ours: true,
				ticket: "closes_it",
				approval: "missing",
				reviews: "passed",
				reviewKinds: kinds({"review-code": "passed", "review-doc": "passed", governance: "passed"}),
				checks: "green",
				mergeable: "clean",
				comments: [],
			},
		],
		[
			// Code and doc passed. It changed a rendered page, and the rendered review never ran.
			"open-review-never-ran",
			{
				head: "b496d5ebe7c743ab98b757de97c39b9a6b5918cf",
				state: "open",
				ours: true,
				ticket: "closes_it",
				approval: "not_needed",
				reviews: "missing",
				reviewKinds: kinds({
					"review-code": "passed",
					"review-doc": "passed",
					"review-ui": "missing",
				}),
				checks: "green",
				mergeable: "clean",
				comments: [],
			},
		],
		[
			"open-failing-check",
			{
				head: "adb3f8c461aa4bc426f75babac55a2f086b98ea8",
				state: "open",
				ours: false,
				ticket: "none",
				approval: "missing",
				reviews: "failed",
				reviewKinds: kinds({"review-code": "failed", "review-doc": "failed", governance: "failed"}),
				checks: "red",
				mergeable: "conflicts",
				comments: [],
			},
		],
		[
			"open-person-comment",
			{
				head: "9eb6b52c75d64b555547780717bd43a2460bb658",
				state: "open",
				ours: true,
				ticket: "closes_it",
				approval: "not_needed",
				reviews: "passed",
				reviewKinds: kinds({"review-code": "passed", "review-doc": "passed"}),
				checks: "green",
				mergeable: "clean",
				comments: [{id: "PRRT_kwDOSZAM-86kfkii", by: "person"}],
			},
		],
		[
			// Its reviews passed on an earlier commit. None binds to this head.
			"closed",
			{
				head: "3d93d35ce997fb9577b64e1a1ea17a1ef0c7da07",
				state: "closed",
				ours: true,
				ticket: "part_of_it",
				approval: "missing",
				reviews: "missing",
				reviewKinds: kinds({
					"review-code": "missing",
					"review-doc": "missing",
					governance: "missing",
				}),
				checks: "red",
				mergeable: "unknown",
				comments: [],
			},
		],
		[
			"draft",
			{
				head: "54be530c5780736291d670523162274e723ec8b6",
				state: "draft",
				ours: true,
				ticket: "closes_it",
				approval: "not_needed",
				reviews: "passed",
				reviewKinds: kinds({
					"review-code": "passed",
					"review-skill": "passed",
					governance: "passed",
				}),
				checks: "green",
				mergeable: "conflicts",
				comments: [],
			},
		],
	])("%s", async (name, facts) => {
		expect(await factsOn(recorded(name))).toEqual(facts);
	});

	it("asks GitHub where the pull request stands, then for the pull request with the base's files beside it, and only reads", async () => {
		const {gh, calls} = fakeGh({pr: recorded("merged"), base: "trunk"});
		await Effect.runPromise(readPrFacts(gh, WHO)("https://github.com/example/repo/pull/7"));

		// No protected file changed, so no team is read.
		expect(calls).toHaveLength(2);
		const [where, whole] = calls as [readonly string[], readonly string[]];
		expect(where.slice(0, 8)).toEqual([
			"api",
			"graphql",
			"-f",
			"owner=example",
			"-f",
			"name=repo",
			"-F",
			"number=7",
		]);
		expect(whole).toContain("codeowners=trunk:.github/CODEOWNERS");
		expect(whole).toContain("baseConfig=trunk:.fabrika.jsonc");
		expect(whole).toContain("headConfig=b22ac7cd48f740d4eb54f7c2ec1d4c5e7e85b0bf:.fabrika.jsonc");
		expect(calls.flat().join(" ")).not.toMatch(/mutation/i);
	});

	it("reads the owning team only when a protected file changed", async () => {
		const {gh, calls} = fakeGh({pr: recorded("open-awaiting-approval")});
		await Effect.runPromise(readPrFacts(gh, WHO)(PR));

		expect(calls).toHaveLength(3);
		expect(calls[2]).toEqual(expect.arrayContaining(["org=example-org", "team=control-plane"]));
	});
});

describe("what the machine answers on each", () => {
	it.each([
		[
			"merged",
			{
				kind: "done",
				part: false,
				commit: "b22ac7cd48f740d4eb54f7c2ec1d4c5e7e85b0bf",
				cleanup: "not_run",
			},
		],
		[
			"merged-approved",
			{
				kind: "done",
				part: false,
				commit: "7779cf9be905f5c1b0c51a991f3a1a199e78b96e",
				cleanup: "not_run",
			},
		],
		["open-awaiting-approval", {kind: "ask", who: "owner", for: "approval"}],
		["open-review-never-ran", {kind: "send", to: "reviewer", why: "no_review"}],
		// Red, conflicting and failed review: "not ours" is the first line it trips.
		["open-failing-check", {kind: "skip", why: "not_ours"}],
		["open-person-comment", {kind: "ask", who: "commenter", for: "comment"}],
		["closed", {kind: "skip", why: "closed"}],
		["draft", {kind: "skip", why: "draft"}],
	])("%s", async (name, outcome) => {
		const found = await lookOn(recorded(name));

		expect(found.outcome).toEqual(outcome);
		expect(found.wouldSend).toBeNull();
		expect(found.facts).not.toBeNull();
	});

	it("the clean one would be queued, and nothing is sent", async () => {
		const found = await lookOn(recorded("open-clean"));
		const head = "9eb6b52c75d64b555547780717bd43a2460bb658";

		expect(found.outcome).toBeNull();
		expect(found.wouldSend).toEqual({
			type: "ship_enqueue",
			pr: PR,
			head,
			intent: `ship/${PR}/enqueue/${head}`,
		});
	});

	it("with its checks still running, the clean one would be waited on, and nothing is sent", async () => {
		const found = await lookOn(
			changed(
				"open-clean",
				(pr) => (pr.commits.nodes[0].commit.statusCheckRollup = {state: "PENDING"}),
			),
		);

		expect(found).toMatchObject({outcome: null, wouldSend: null, wouldWaitFor: "checks"});
	});

	it("with red checks, the clean one would have them run again, and that write is not sent either", async () => {
		const found = await lookOn(
			changed(
				"open-clean",
				(pr) => (pr.commits.nodes[0].commit.statusCheckRollup = {state: "FAILURE"}),
			),
		);
		const head = "9eb6b52c75d64b555547780717bd43a2460bb658";

		expect(found.outcome).toBeNull();
		expect(found.wouldSend).toEqual({
			type: "ship_rerun_checks",
			pr: PR,
			head,
			intent: `ship/${PR}/rerun/${head}`,
		});
		expect(found.wouldWaitFor).toBeNull();
	});

	it("the one awaiting approval would be queued once the other owner approves its head", async () => {
		const approve = (commit: string, login = "second-owner") =>
			changed(
				"open-awaiting-approval",
				(pr) =>
					(pr.reviews.nodes = [
						{state: "APPROVED", author: {__typename: "User", login}, commit: {oid: commit}},
					]),
			);
		const head = "7c80607bd0e3131830e7e6afab7844125185e2f6";
		const asks = {kind: "ask", who: "owner", for: "approval"};

		expect((await lookOn(approve(head))).wouldSend).toMatchObject({type: "ship_enqueue", head});
		// An approval of an earlier commit, or the author's own, or a stranger's, is not one.
		expect((await lookOn(approve("122533139cb89aad3d7b542a65ff652721edd156"))).outcome).toEqual(
			asks,
		);
		expect((await lookOn(approve(head, "repo-owner"))).outcome).toEqual(asks);
		expect((await lookOn(approve(head, "someone-else"))).outcome).toEqual(asks);
	});
});

describe("the reviews a pull request needs", () => {
	const dropVerdict = (kind: string) => (pr: Record<string, any>) =>
		(pr.comments.nodes = pr.comments.nodes.filter(
			(c: {body: string}) => !c.body.startsWith(`${kind}:`),
		));

	it("two needed and both passed is passed", async () => {
		const facts = await factsOn(recorded("open-clean"));

		expect(facts.reviews).toBe("passed");
		expect(facts.reviewKinds).toEqual(kinds({"review-code": "passed", "review-doc": "passed"}));
	});

	it("two needed, one passed and one never ran, is missing, and the machine sends it back to the reviewer", async () => {
		const answer = changed("open-clean", dropVerdict("review-doc"));

		expect(await factsOn(answer)).toMatchObject({
			reviews: "missing",
			reviewKinds: kinds({"review-code": "passed", "review-doc": "missing"}),
		});
		expect((await lookOn(answer)).outcome).toEqual({
			kind: "send",
			to: "reviewer",
			why: "no_review",
		});
	});

	it("two needed and one failed is failed, and the machine sends it back to the builder", async () => {
		const answer = changed("open-clean", (pr) => {
			pr.comments.nodes[1].body =
				"review-doc: FAIL @ 9eb6b52c75d64b555547780717bd43a2460bb658 — a claim outruns the code";
		});

		expect(await factsOn(answer)).toMatchObject({
			reviews: "failed",
			reviewKinds: kinds({"review-code": "passed", "review-doc": "failed"}),
		});
		expect((await lookOn(answer)).outcome).toEqual({
			kind: "send",
			to: "builder",
			why: "review_failed",
		});
	});

	it("a failing verdict of a kind it does not need still fails it", async () => {
		const answer = changed("open-clean", (pr) =>
			pr.comments.nodes.push({
				createdAt: "2026-10-09T07:20:00Z",
				body: "governance: FAIL @ 9eb6b52c75d64b555547780717bd43a2460bb658 — weakens a rule",
				author: {__typename: "User", login: "repo-owner"},
			}),
		);

		expect(await factsOn(answer)).toMatchObject({
			reviews: "failed",
			reviewKinds: kinds({"review-code": "passed", "review-doc": "passed", governance: "failed"}),
		});
	});

	it("a change under a governed folder needs the governance review, by the base's rules or the head's", async () => {
		const answer = changed(
			"open-clean",
			(_pr, repo) =>
				(repo.headConfig.text = '{ "governedRoots": [".fabrika.jsonc", "packages/tea/docs/"] }'),
		);

		expect((await factsOn(answer)).reviewKinds).toEqual(
			kinds({"review-code": "passed", "review-doc": "passed", governance: "missing"}),
		);
	});

	it.each<[string, (pr: Record<string, any>, repo: Record<string, any>) => void]>([
		["the repo has no config at the base", (_pr, repo) => (repo.baseConfig = null)],
		["the head has no config", (_pr, repo) => (repo.headConfig = null)],
		["the config does not parse", (_pr, repo) => (repo.baseConfig.text = "{ not json")],
		[
			"the config's governed folders are not a list of texts",
			(_pr, repo) => (repo.baseConfig.text = '{ "governedRoots": "all" }'),
		],
		["more files changed than one call holds", (pr) => (pr.files.pageInfo.hasNextPage = true)],
		["no file changed", (pr) => (pr.files.nodes = [])],
	])("is unknown when %s, and the machine cannot tell", async (_name, change) => {
		const answer = changed("open-clean", change);

		expect(await factsOn(answer)).toMatchObject({reviews: "unknown", reviewKinds: []});
		expect((await lookOn(answer)).outcome).toEqual({kind: "stuck", why: "reviews_unknown"});
	});

	it("does not count a verdict posted by an account whose verdicts do not count", async () => {
		const facts = await factsOn(recorded("open-clean"), {own: OWNERS, reviewers: ["repo-owner"]});

		expect(facts.ours).toBe(true);
		expect(facts).toMatchObject({
			reviews: "missing",
			reviewKinds: kinds({"review-code": "missing", "review-doc": "missing"}),
		});
	});

	it("works out the kinds from the files, the way today's fabrika does", () => {
		const rules = {governed: [".decisions/", ".github/", ".fabrika.jsonc"], ui: ["apps/web/src/"]};

		expect(kindsNeeded(["src/a.ts"], rules)).toEqual(["review-code"]);
		expect(kindsNeeded(["docs/a.md"], rules)).toEqual(["review-doc"]);
		expect(
			kindsNeeded(
				["skills/x/SKILL.md", ".claude/agents/a.md", "claude-plugins/p/contract.md"],
				rules,
			),
		).toEqual(["review-skill"]);
		expect(kindsNeeded(["apps/web/src/App.tsx"], rules)).toEqual(["review-code", "review-ui"]);
		// A test beside a rendered page is not rendered work.
		expect(kindsNeeded(["apps/web/src/App.test.tsx"], rules)).toEqual(["review-code"]);
		expect(kindsNeeded([".decisions/0001-x.md"], rules)).toEqual(["review-doc", "governance"]);
		expect(kindsNeeded([".fabrika.jsonc"], rules)).toEqual(["review-code", "governance"]);
	});

	it("reads a config with comments and trailing commas, and falls back to fabrika's default governed folders", () => {
		expect(
			parseJsonc(
				'{\n  // a note with "quotes"\n  "a": "x // not a comment", /* and\n another */ "b": [1, 2,],\n}',
			),
		).toEqual({a: "x // not a comment", b: [1, 2]});
		expect(parseJsonc("{ nope")).toBeUndefined();
		expect(rulesOf('{ "governedRoots": ["a/"], "uiSurfaces": [{ "prefix": "web/" }] }')).toEqual({
			governed: ["a/"],
			ui: ["web/"],
		});
		expect(rulesOf("{}")).toEqual({
			governed: [".decisions/", ".claude/", ".github/", ".fabrika.jsonc"],
			ui: [],
		});
		expect(rulesOf("[]")).toBeNull();
		expect(rulesOf('{ "uiSurfaces": [{ "name": "web" }] }')).toBeNull();
	});
});

describe("the verdicts at a head", () => {
	const HEAD = "7c80607bd0e3131830e7e6afab7844125185e2f6";
	const owner = {__typename: "User", login: "repo-owner"};
	const said = (body: string, minute: number, author: typeof owner | null = owner) => ({
		createdAt: `2026-10-05T10:${String(minute).padStart(2, "0")}:00Z`,
		body,
		author,
	});
	const at = (comments: ReturnType<typeof said>[], reviewers = ["repo-owner"]) =>
		Object.fromEntries(verdictsAt(HEAD, comments, reviewers));

	it("holds none when no verdict binds to this head, however many passed before", () => {
		expect(at([])).toEqual({});
		expect(
			at([said("review-code: PASS @ 122533139cb89aad3d7b542a65ff652721edd156 — ok", 1)]),
		).toEqual({});
		expect(at([said("Looks good to me.", 1)])).toEqual({});
	});

	it("takes the last verdict of one kind at the same head", () => {
		const first = said(`review-code: FAIL @ ${HEAD} — red`, 1);
		const second = said(`review-code: PASS @ ${HEAD} — green after a re-run`, 2);

		expect(at([first, second])).toEqual({"review-code": "PASS"});
		expect(at([second, first])).toEqual({"review-code": "PASS"});
	});

	it("does not count a verdict from any other account, or from one that is gone", () => {
		expect(
			at([
				said(`review-code: PASS @ ${HEAD} — trust me`, 1, {
					__typename: "User",
					login: "someone-else",
				}),
			]),
		).toEqual({});
		expect(at([said(`review-code: PASS @ ${HEAD} — ok`, 1, null)])).toEqual({});
	});

	it("reads an old verdict's short commit, and an account in any case", () => {
		expect(at([said("review-code: PASS @ 7c80607bd0 — ok", 1)], ["Repo-Owner"])).toEqual({
			"review-code": "PASS",
		});
	});
});

describe("the owner's approval", () => {
	const head = "7c80607bd0e3131830e7e6afab7844125185e2f6";
	const approval = async (
		change: (pr: Record<string, any>, repo: Record<string, any>) => void,
		team?: string | "breaks",
	) => (await factsOn(changed("open-awaiting-approval", change), WHO, team)).approval;
	const oneOwner = changedTeam((members) => (members.nodes = [{login: "repo-owner"}]));
	const says =
		(body: string, login = "repo-owner") =>
		(pr: Record<string, any>) =>
			pr.comments.nodes.push({
				createdAt: "2026-10-05T11:00:00Z",
				body,
				author: {__typename: "User", login},
			});

	it("is not needed when no changed file has an owner", async () => {
		expect(await approval((pr) => (pr.files.nodes = [{path: "apps/web/src/App.tsx"}]))).toBe(
			"not_needed",
		);
		// A row with no owner takes a file out of a folder that has one.
		expect(
			await approval(
				(_pr, repo) => (repo.codeowners.text += "/.github/workflows/pr-cleanup.yml\n"),
			),
		).toBe("not_needed");
	});

	it("is missing when a protected file changed and no owner approved this head", async () => {
		expect(await approval(() => {})).toBe("missing");
	});

	it("an owner named by account, not by team, approves without any team being read", async () => {
		const {gh, calls} = fakeGh({
			pr: changed("open-awaiting-approval", (pr, repo) => {
				repo.codeowners.text = "/.github/ @second-owner @repo-owner\n";
				pr.reviews.nodes = [
					{
						state: "APPROVED",
						author: {__typename: "User", login: "Second-Owner"},
						commit: {oid: head},
					},
				];
			}),
		});

		expect((await Effect.runPromise(readPrFacts(gh, WHO)(PR))).approval).toBe("given");
		expect(calls).toHaveLength(2);
	});

	it("a repo's one owner approves their own pull request with the comment that names the commit", async () => {
		expect(await approval(() => {}, oneOwner)).toBe("missing");
		expect(await approval(says(`control-plane-self-approval @ ${head}`), oneOwner)).toBe("given");
		expect(await approval(says("control-plane-self-approval @ 7c80607bd0"), oneOwner)).toBe(
			"given",
		);
		// For another commit, or said by someone who is not the owner: not an approval.
		expect(
			await approval(
				says("control-plane-self-approval @ 122533139cb89aad3d7b542a65ff652721edd156"),
				oneOwner,
			),
		).toBe("missing");
		expect(
			await approval(says(`control-plane-self-approval @ ${head}`, "someone-else"), oneOwner),
		).toBe("missing");
		// With two owners the comment is not enough: the other owner has to review.
		expect(await approval(says(`control-plane-self-approval @ ${head}`))).toBe("missing");
	});

	it.each<
		[
			string,
			(pr: Record<string, any>, repo: Record<string, any>) => void,
			string | "breaks" | undefined,
		]
	>([
		["the repo has no CODEOWNERS", (_pr, repo) => (repo.codeowners = null), undefined],
		["the owning team cannot be read", () => {}, "breaks"],
		["the owning team is not there", () => {}, '{"data":{"organization":{"team":null}}}'],
		[
			"the team has more members than one call holds",
			() => {},
			changedTeam((members) => (members.pageInfo.hasNextPage = true)),
		],
		[
			"more files changed than one call holds, and none read is protected",
			(pr) => {
				pr.files.pageInfo.hasNextPage = true;
				pr.files.nodes = [{path: "a.ts"}];
			},
			undefined,
		],
	])("is unknown when %s, and nobody is asked", async (_name, change, team) => {
		expect(await approval(change, team)).toBe("unknown");
	});

	it("on unknown, the machine cannot tell rather than asking an owner", async () => {
		const found = await lookOn(
			changed("open-awaiting-approval", (_pr, repo) => (repo.codeowners = null)),
		);

		expect(found.outcome).toEqual({kind: "stuck", why: "approval_unknown"});
	});
});

describe("an answer that cannot be read is the Cmd's err, never a throw", () => {
	const unknown = {_tag: "unknown"};

	it.each<[string, string | "breaks"]>([
		["the call breaks", "breaks"],
		["not JSON", "gh: not logged in"],
		["JSON of another shape", '{"data":{"repository":{"pullRequest":null}}}'],
		["a field is missing", changed("merged", (pr) => delete pr.mergeable)],
		["a state GitHub does not have", changed("merged", (pr) => (pr.state = "LOCKED"))],
		[
			"checks of a commit that is not the head",
			changed(
				"merged",
				(pr) => (pr.commits.nodes[0].commit.oid = "0000000000000000000000000000000000000000"),
			),
		],
		["no commit at all", changed("merged", (pr) => (pr.commits.nodes = []))],
		[
			"more review threads than one call holds",
			changed("merged", (pr) => (pr.reviewThreads.pageInfo.hasNextPage = true)),
		],
	])("%s", async (_name, answer) => {
		expect(await failureOn(answer)).toEqual(unknown);
		// And through the handler and the machine: one typed ending.
		const found = await lookOn(answer);
		expect(found).toMatchObject({
			facts: null,
			outcome: {kind: "stuck", why: "read_failed"},
			wouldSend: null,
		});
	});

	it("a head that moved between the two calls is a failed read, not two commits read as one", async () => {
		const moved = JSON.stringify({
			data: {
				repository: {
					pullRequest: {
						headRefOid: "0000000000000000000000000000000000000000",
						baseRefName: "main",
					},
				},
			},
		});
		const gh: Gh = (args) =>
			Effect.succeed(
				args.some((arg) => arg.startsWith("codeowners=")) ? recorded("merged") : moved,
			);

		expect(await Effect.runPromise(Effect.flip(readPrFacts(gh, WHO)(PR)))).toEqual(unknown);
	});

	it("a URL that is not a pull request's is refused before any call", async () => {
		const {gh, calls} = fakeGh({pr: recorded("merged")});

		expect(
			await Effect.runPromise(
				Effect.flip(readPrFacts(gh, WHO)("https://github.com/example/repo/issues/7")),
			),
		).toEqual(unknown);
		expect(calls).toEqual([]);
		expect(prOf("https://github.com/example/repo/pull/7")).toEqual({
			owner: "example",
			name: "repo",
			number: 7,
		});
	});

	it("the handler hands the service's failure on as it is", async () => {
		const host = hostOf(() => Effect.fail({_tag: "unknown" as const}));
		const failure = await Effect.runPromise(
			Effect.flip(shipReadInterpret.ship_facts(readShipFacts({pr: PR}))).pipe(Effect.provide(host)),
		);

		expect(failure).toEqual(unknown);
	});

	it("on the engine, the machine ends as cannot tell and sends nothing else", async () => {
		const never = () => Effect.die("a write was sent");
		const program = Effect.gen(function* () {
			const handle = yield* run(ship, {
				ctx: undefined,
				interpret: {
					...shipReadInterpret,
					ship_rerun_checks: never,
					ship_enqueue: never,
					ship_finish: never,
				},
				subscribe: {
					ship_checks: (): Stream.Stream<ShipMsg> => Stream.never,
					ship_queue: (): Stream.Stream<ShipMsg> => Stream.never,
				},
				terminal: (s) => s.phase === "over",
			});
			const runtime = yield* handle.ready;
			yield* runtime.dispatch({type: "start", pr: PR});
			return yield* runtime.done().pipe(Effect.timeout("4 seconds"));
		});
		const host = hostOf(readPrFacts(fakeGh({pr: "not json"}).gh, WHO));
		const end = await Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(host)));

		expect(end).toMatchObject({
			phase: "over",
			pr: PR,
			outcome: {kind: "stuck", why: "read_failed"},
		});
	});
});

describe("the ticket a body serves", () => {
	it.each<[string, ShipFacts["ticket"]]>([
		["Fixes #12", "closes_it"],
		["closes #12", "closes_it"],
		["Resolved: #12", "closes_it"],
		["Fixes example/repo#12", "closes_it"],
		["Fixes https://github.com/example/repo/issues/12", "closes_it"],
		["Part of #12", "part_of_it"],
		["part of example/repo#12", "part_of_it"],
		// A closing word wins: the pull request closes one ticket and is part of another.
		["Part of #12\n\nFixes #13", "closes_it"],
		// A mention serves no ticket.
		["Refs #12", "none"],
		["Re: #12, see also #13", "none"],
		["This fixes the prefix. No ticket.", "none"],
		["", "none"],
	])("%j is %s", (body, ticket) => {
		expect(ticketOf(body)).toBe(ticket);
	});

	it.each<[string, ReturnType<typeof ticketIn>]>([
		["Fixes #12", {link: "closes_it", owner: null, name: null, number: 12}],
		["Fixes example/repo#12", {link: "closes_it", owner: "example", name: "repo", number: 12}],
		[
			"Closes https://github.com/other-org/the.repo/issues/7",
			{link: "closes_it", owner: "other-org", name: "the.repo", number: 7},
		],
		["Part of #12", {link: "part_of_it", owner: null, name: null, number: 12}],
		// The closing line names the ticket, wherever it stands in the text.
		["Part of #12\n\nFixes #13", {link: "closes_it", owner: null, name: null, number: 13}],
		// The first closing line wins.
		["Fixes #13\nFixes #14", {link: "closes_it", owner: null, name: null, number: 13}],
		["Refs #12", null],
	])("%j names %j", (body, ticket) => {
		expect(ticketIn(body)).toEqual(ticket);
	});
});

describe("the text review that reads one file", () => {
	it.each([
		["src/a.ts", "review-code"],
		["package.json", "review-code"],
		[".github/workflows/build.yaml", "review-code"],
		["docs/a.md", "review-doc"],
		[".changeset/a-change.md", "review-doc"],
		["skills/x/SKILL.md", "review-skill"],
		["SKILL.md", "review-skill"],
		[".claude/agents/a.md", "review-skill"],
		["claude-plugins/p/src/tool.ts", "review-skill"],
	] as const)("%s is read by %s", (path, kind) => {
		expect(textKindOf(path)).toBe(kind);
	});
});

describe("the other facts, one at a time", () => {
	const thread = (pr: Record<string, any>, comments: {body: string; author: unknown}[]) =>
		(pr.reviewThreads.nodes = [{id: "t1", isResolved: false, comments: {nodes: comments}}]);
	const bot = {__typename: "Bot", login: "scan-bot"};
	const user = {__typename: "User", login: "a-reviewer"};

	it("an unresolved thread only a bot wrote is the bot's", async () => {
		const facts = await factsOn(
			changed("open-clean", (pr) => thread(pr, [{body: "Unused variable.", author: bot}])),
		);

		expect(facts.comments).toEqual([{id: "t1", by: "bot"}]);
	});

	it("a comment with a machine's hidden mark is not a person's, whoever's account posted it", async () => {
		const marked = {body: "A finding.\n\n<!-- tea-fabrika review/1 -->", author: user};

		expect((await factsOn(changed("open-clean", (pr) => thread(pr, [marked])))).comments).toEqual([
			{id: "t1", by: "bot"},
		]);
		expect(
			(
				await factsOn(
					changed("open-clean", (pr) => thread(pr, [marked, {body: "I disagree.", author: user}])),
				)
			).comments,
		).toEqual([{id: "t1", by: "person"}]);
	});

	it("a comment from an account that is gone counts as a person's", async () => {
		const facts = await factsOn(
			changed("open-clean", (pr) => thread(pr, [{body: "Why this way?", author: null}])),
		);

		expect(facts.comments).toEqual([{id: "t1", by: "person"}]);
	});

	it("no check on the head reads as pending, never as green", async () => {
		const facts = await factsOn(
			changed("open-clean", (pr) => (pr.commits.nodes[0].commit.statusCheckRollup = null)),
		);

		expect(facts.checks).toBe("pending");
	});

	it("a check that errored is red, and one still expected is pending", async () => {
		const withState = (state: string) =>
			factsOn(
				changed("open-clean", (pr) => (pr.commits.nodes[0].commit.statusCheckRollup = {state})),
			);

		expect((await withState("ERROR")).checks).toBe("red");
		expect((await withState("EXPECTED")).checks).toBe("pending");
	});

	it("an author that is gone, or not one of the repo's own, is not ours", async () => {
		expect((await factsOn(changed("open-clean", (pr) => (pr.author = null)))).ours).toBe(false);
		expect(
			(await factsOn(recorded("open-clean"), {own: ["repo-owner"], reviewers: OWNERS})).ours,
		).toBe(false);
	});
});
