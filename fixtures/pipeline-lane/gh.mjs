#!/usr/bin/env node
// A stand-in `gh`, for proof that touches no real GitHub: the lane starts this as it would start the
// GitHub CLI. Today's version. Its pull requests live in a state file, and its git is real: the bare
// remote the lane pushes to. So a head it answers is the head the lane pushed, and a merge it makes
// is a real commit on the remote's main.
//
// It is strict. A call it does not know word for word exits 4 and is written down as `unknown`, and
// the tests fail on any such row, so nothing passes by being unasked. That holds for the GraphQL
// queries too: each must match a copy below, whitespace aside. A query that changes needs its copy
// changed here, with the answer's shape checked against `fixtures/code-host/`.
//
// What a stand-in cannot prove: that GitHub really answers like this. Only its answer to the facts
// query is compared with a recorded one in `fixtures/code-host/`. Every other answer, and every
// refusal, is written from what the code expects. See
// `packages/pipeline/src/stages/pipeline/lane-fixture.ts` for how a test sets its story.
//
// `FAKE_GH_DIR`: the folder of `state.json` and `calls.jsonl`. The host's keep-list drops this name,
// so `makeFakeGh` names it in a small wrapper.

import {spawnSync} from "node:child_process";
import {appendFileSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const dir = process.env.FAKE_GH_DIR;
if (!dir) {
	process.stderr.write("the stand-in gh has no FAKE_GH_DIR\n");
	process.exit(5);
}
const STATE = join(dir, "state.json");
const CALLS = join(dir, "calls.jsonl");
const LOCK = join(dir, "lock");

const IDENTITY = {
	GIT_AUTHOR_NAME: "stand-in",
	GIT_AUTHOR_EMAIL: "stand-in@fabrika.invalid",
	GIT_COMMITTER_NAME: "stand-in",
	GIT_COMMITTER_EMAIL: "stand-in@fabrika.invalid",
};

// ---------------------------------------------------------------- the queries, as the code sends them

const QUERIES = {
	// packages/pipeline/src/code-host-github.ts: WHERE
	where: `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { headRefOid baseRefName } }
}`,
	// packages/pipeline/src/code-host-github.ts: QUERY
	facts: `
query($owner: String!, $name: String!, $number: Int!, $codeowners: String!, $baseConfig: String!, $headConfig: String!) {
  repository(owner: $owner, name: $name) {
    codeowners: object(expression: $codeowners) { ... on Blob { text } }
    baseConfig: object(expression: $baseConfig) { ... on Blob { text } }
    headConfig: object(expression: $headConfig) { ... on Blob { text } }
    pullRequest(number: $number) {
      state
      isDraft
      headRefOid
      body
      author { __typename login }
      mergeable
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
      files(first: 100) { pageInfo { hasNextPage } nodes { path } }
      reviews(last: 100) { nodes { state author { __typename login } commit { oid } } }
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes { id isResolved comments(first: 50) { nodes { body author { __typename login } } } }
      }
      comments(last: 100) { nodes { createdAt body author { __typename login } } }
    }
  }
}`,
	// packages/pipeline/src/code-host-github.ts: CHECKS_NOW
	checks_now: `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { headRefOid commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } } }
  }
}`,
	// packages/pipeline/src/code-host-github-writes.ts: ENQUEUE_READ
	enqueue_read: `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { id state headRefOid mergeable isInMergeQueue isMergeQueueEnabled }
  }
}`,
	// packages/pipeline/src/code-host-github-writes.ts: MERGE_READ
	merge_read: `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed
    pullRequest(number: $number) { id state baseRefName headRefOid mergeable mergeCommit { oid } }
  }
}`,
	// packages/pipeline/src/code-host-github-writes.ts: RULES_READ
	rules_read: `query($owner: String!, $name: String!, $ref: String!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) { branchProtectionRule { id } rules(first: 1) { totalCount } }
  }
}`,
	// packages/pipeline/src/code-host-github-writes.ts: MERGE_WRITE
	merge_write: `
mutation($pull: ID!, $head: GitObjectID!, $method: PullRequestMergeMethod!) {
  mergePullRequest(input: { pullRequestId: $pull, expectedHeadOid: $head, mergeMethod: $method }) {
    pullRequest { mergeCommit { oid } }
  }
}`,
};

/** `--jq` the code sends with a compare, as packages/pipeline/src/code-host-github.ts writes it. */
const COMPARE_JQ = "{tested: .merge_base_commit.sha, tip: .base_commit.sha}";
const DIFF_HEADER = "Accept: application/vnd.github.diff";

const squeeze = (text) => text.replace(/\s+/g, " ").trim();
const queryKind = (text) =>
	Object.entries(QUERIES).find(([, query]) => squeeze(query) === squeeze(text))?.[0] ?? null;
const variablesIn = (text) => [...text.matchAll(/\$(\w+):/g)].map((m) => m[1]).sort();

// ---------------------------------------------------------------- the two ways a call ends badly

/** A call this stand-in does not know. */
class Unknown extends Error {}
/** A call GitHub would answer with a refusal: its words on stderr, as `gh` prints them. */
class Refused extends Error {
	constructor(says, out = "") {
		super(says);
		this.out = out;
	}
}

// ---------------------------------------------------------------- real git on the bare remote

const gitRun = (state, ...args) =>
	spawnSync("git", ["--git-dir", state.remote, ...args], {
		encoding: "utf8",
		env: {PATH: process.env.PATH, ...IDENTITY},
	});
const git = (state, ...args) => {
	const ran = gitRun(state, ...args);
	if (ran.status !== 0) throw new Error(`git ${args.join(" ")}: ${ran.stderr}`);
	return ran.stdout.trim();
};
const gitMaybe = (state, ...args) => {
	const ran = gitRun(state, ...args);
	return ran.status === 0 ? ran.stdout.trim() : null;
};
/** Whole text, as a blob answers it: `git show` with nothing trimmed. */
const blob = (state, expression) => {
	const ran = gitRun(state, "show", expression);
	return ran.status === 0 ? {text: ran.stdout} : null;
};
const isAncestor = (state, a, b) =>
	gitRun(state, "merge-base", "--is-ancestor", a, b).status === 0;
const lines = (text) => text.split("\n").filter((line) => line !== "");
const mainTip = (state, base = "main") => git(state, "rev-parse", `refs/heads/${base}`);

// ---------------------------------------------------------------- what GitHub would know

const headNow = (state, pr) =>
	pr.state === "MERGED" ? pr.mergedHead : git(state, "rev-parse", `refs/heads/${pr.branch}`);

const mergeableNow = (state, pr) => {
	if (pr.state !== "OPEN") return "UNKNOWN";
	const ran = gitRun(state, "merge-tree", "--write-tree", mainTip(state, pr.base), headNow(state, pr));
	return ran.status === 0 ? "MERGEABLE" : "CONFLICTING";
};

/** The checks' moment: they have finished once the checks wait has asked `settleAfter` times. */
const settled = (state) => state.checkReads >= (state.story.settleAfter ?? 0);
const checksNow = (state) => state.story.checks ?? [];

/** The rollup, as GraphQL sums it: every check on the commit, required or not. `null`: none reported. */
const rollupState = (state) => {
	const checks = checksNow(state);
	if (checks.length === 0) return null;
	if (!settled(state)) return "PENDING";
	return checks.some((check) => check.ends === "FAILURE") ? "FAILURE" : "SUCCESS";
};
const rollup = (state) => {
	const word = rollupState(state);
	return word === null ? null : {state: word};
};

const AUTHOR = {__typename: "User", login: "lane-person"};

const findPull = (state, number) => {
	const pr = state.pulls.find((pull) => pull.number === Number(number));
	if (pr === undefined) throw new Unknown(`no pull request ${number}`);
	return pr;
};

/** A person pushes one more commit, once, at the moment the story names. */
const movedByAPerson = (state, pr) => {
	if (state.moved || pr.state !== "OPEN") return;
	const before = headNow(state, pr);
	const moved = git(
		state,
		"commit-tree",
		`${before}^{tree}`,
		"-p",
		before,
		"-m",
		"A person pushed one more commit.",
	);
	git(state, "update-ref", `refs/heads/${pr.branch}`, moved);
	state.moved = true;
};

/** A person merges the pull request by hand, once, on a new head of theirs if the story says so. */
const mergedByAPerson = (state, pr) => {
	if (state.handMerged || pr.state !== "OPEN") return;
	state.handMerged = true;
	if (state.story.mergedByAPerson.newHead) movedByAPerson(state, pr);
	const head = headNow(state, pr);
	const tip = mainTip(state, pr.base);
	const tree = git(state, "merge-tree", "--write-tree", tip, head).split("\n")[0];
	const commit = git(state, "commit-tree", tree, "-p", tip, "-p", head, "-m", "Merged by a person.");
	git(state, "update-ref", `refs/heads/${pr.base}`, commit);
	pr.state = "MERGED";
	pr.mergedHead = head;
	pr.mergeCommit = commit;
};

/** A head that has reached main is merged, as GitHub marks it. */
const markLanded = (state, base, commit) => {
	for (const pr of state.pulls) {
		if (pr.state !== "OPEN" || pr.base !== base) continue;
		const head = headNow(state, pr);
		if (!isAncestor(state, head, mainTip(state, base))) continue;
		pr.state = "MERGED";
		pr.mergedHead = head;
		pr.mergeCommit = commit;
	}
};

// ---------------------------------------------------------------- GraphQL

const graphql = (state, fields) => {
	const query = fields.find(([name]) => name === "query")?.[1];
	if (query === undefined) throw new Unknown("graphql with no query");
	const kind = queryKind(query);
	if (kind === null) throw new Unknown(`a query it does not know: ${squeeze(query).slice(0, 300)}`);
	const given = fields.filter(([name]) => name !== "query");
	const names = given.map(([name]) => name).sort();
	if (JSON.stringify(names) !== JSON.stringify(variablesIn(query)))
		throw new Unknown(`${kind}: variables ${names.join(", ")}`);
	const at = Object.fromEntries(given);
	if (at.owner !== undefined && `${at.owner}/${at.name}` !== state.repo)
		throw new Unknown(`${kind}: another repository, ${at.owner}/${at.name}`);
	return {kind, answer: () => GRAPHQL[kind](state, at)};
};

const GRAPHQL = {
	where: (state, at) => {
		const pr = findPull(state, at.number);
		if (state.story.mergedByAPerson?.at === "next_read" && state.factsReads > 0)
			mergedByAPerson(state, pr);
		return {
			data: {
				repository: {pullRequest: {headRefOid: headNow(state, pr), baseRefName: pr.base}},
			},
		};
	},
	facts: (state, at) => {
		const pr = findPull(state, at.number);
		if (state.story.moveHeadAt === "facts") movedByAPerson(state, pr);
		state.factsReads += 1;
		const head = headNow(state, pr);
		return {
			data: {
				repository: {
					codeowners: blob(state, at.codeowners),
					baseConfig: blob(state, at.baseConfig),
					headConfig: blob(state, at.headConfig),
					pullRequest: {
						state: pr.state,
						isDraft: false,
						headRefOid: head,
						body: pr.body,
						author: AUTHOR,
						mergeable: mergeableNow(state, pr),
						commits: {nodes: [{commit: {oid: head, statusCheckRollup: rollup(state)}}]},
						files: {
							pageInfo: {hasNextPage: false},
							nodes: lines(git(state, "diff", "--name-only", pr.left, head)).map((path) => ({path})),
						},
						reviews: {nodes: []},
						reviewThreads: {pageInfo: {hasNextPage: false}, nodes: []},
						comments: {
							nodes: pr.comments.map((comment) => ({
								createdAt: comment.createdAt,
								body: comment.body,
								author: AUTHOR,
							})),
						},
					},
				},
			},
		};
	},
	checks_now: (state, at) => {
		const pr = findPull(state, at.number);
		const head = headNow(state, pr);
		state.checkReads += 1;
		return {
			data: {
				repository: {
					pullRequest: {
						headRefOid: head,
						commits: {nodes: [{commit: {oid: head, statusCheckRollup: rollup(state)}}]},
					},
				},
			},
		};
	},
	enqueue_read: (state, at) => {
		const pr = findPull(state, at.number);
		return {
			data: {
				repository: {
					pullRequest: {
						id: pr.id,
						state: pr.state,
						headRefOid: headNow(state, pr),
						mergeable: mergeableNow(state, pr),
						isInMergeQueue: false,
						isMergeQueueEnabled: false,
					},
				},
			},
		};
	},
	merge_read: (state, at) => {
		const pr = findPull(state, at.number);
		if (state.story.moveHeadAt === "merge_read") movedByAPerson(state, pr);
		if (state.story.mergedByAPerson?.at === "merge_read") mergedByAPerson(state, pr);
		return {
			data: {
				repository: {
					squashMergeAllowed: true,
					mergeCommitAllowed: true,
					rebaseMergeAllowed: true,
					pullRequest: {
						id: pr.id,
						state: pr.state,
						baseRefName: pr.base,
						headRefOid: headNow(state, pr),
						mergeable: mergeableNow(state, pr),
						mergeCommit: pr.mergeCommit === null ? null : {oid: pr.mergeCommit},
					},
				},
			},
		};
	},
	rules_read: (state, at) => {
		const ruled = (state.story.rule ?? "none") !== "none";
		return {
			data: {
				repository: {
					ref:
						at.ref === "refs/heads/main"
							? {
									branchProtectionRule: ruled ? {id: "BPR_1"} : null,
									rules: {totalCount: 0},
								}
							: null,
				},
			},
		};
	},
	merge_write: (state, at) => {
		const pr = state.pulls.find((pull) => pull.id === at.pull);
		if (pr === undefined) throw new Unknown(`no pull request with id ${at.pull}`);
		const refusal = (says) =>
			new Refused(
				`GraphQL: ${says} (mergePullRequest)`,
				JSON.stringify({
					data: {mergePullRequest: null},
					errors: [{type: "UNPROCESSABLE", message: says, path: ["mergePullRequest"]}],
				}),
			);
		if (state.story.rule === "refuses")
			throw refusal("Repository rule violations found. At least 1 approving review is required.");
		const head = headNow(state, pr);
		if (head !== at.head) throw refusal("Head branch was modified. Review and try the merge again.");
		if (at.method !== "SQUASH" && at.method !== "MERGE" && at.method !== "REBASE")
			throw new Unknown(`merge_write: method ${at.method}`);
		const tip = mainTip(state, pr.base);
		const tree = git(state, "merge-tree", "--write-tree", tip, head).split("\n")[0];
		const commit = git(state, "commit-tree", tree, "-p", tip, "-m", `Merge ${pr.title}`);
		git(state, "update-ref", `refs/heads/${pr.base}`, commit);
		pr.state = "MERGED";
		pr.mergedHead = head;
		pr.mergeCommit = commit;
		return {data: {mergePullRequest: {pullRequest: {mergeCommit: {oid: commit}}}}};
	},
};

// ---------------------------------------------------------------- REST

const RUN = 501;

const field = (fields, name) => fields.find(([key]) => key === name)?.[1];

/** One REST route: which call it is, and its answer. `null`: no such route. */
const rest = (state, method, path, {fields, jq, headers}) => {
	const prefix = `repos/${state.repo}/`;
	if (!path.startsWith(prefix)) throw new Unknown(`another repository: ${path}`);
	const route = path.slice(prefix.length);
	const exact = (want) => {
		if (jq !== null || headers.length > 0) throw new Unknown(`${want}: flags it does not know`);
	};

	let m = /^issues\/(\d+)\/comments\?per_page=100$/.exec(route);
	if (m !== null && method === "GET") {
		exact("comments_read");
		return {
			kind: "comments_read",
			answer: () => findPull(state, m[1]).comments.map((comment) => ({body: comment.body})),
		};
	}
	m = /^issues\/(\d+)\/comments$/.exec(route);
	if (m !== null && method === "POST") {
		exact("comment_post");
		const body = field(fields, "body");
		if (body === undefined || fields.length !== 1) throw new Unknown("comment_post: fields");
		return {
			kind: "comment_post",
			answer: () => {
				const pr = findPull(state, m[1]);
				pr.comments.push({body, createdAt: new Date().toISOString()});
				return {id: pr.comments.length, body};
			},
		};
	}
	m = /^compare\/([^.]+)\.\.\.([^.]+)$/.exec(route);
	if (m !== null && method === "GET") {
		const [, base, head] = m;
		const left = () => git(state, "merge-base", base, head);
		if (jq !== null) {
			if (jq !== COMPARE_JQ || headers.length > 0) throw new Unknown(`compare: --jq ${jq}`);
			return {
				kind: "main",
				answer: () => ({
					tested: left(),
					tip: git(state, "rev-parse", gitRef(state, base)),
				}),
			};
		}
		if (headers.length === 1 && headers[0] === DIFF_HEADER)
			return {kind: "compare_diff", text: () => git(state, "diff", left(), head)};
		if (headers.length > 0) throw new Unknown(`compare: headers ${headers.join(", ")}`);
		return {
			kind: "compare",
			answer: () => {
				const behind = isAncestor(state, head, base);
				const ahead = isAncestor(state, base, head);
				return {
					status: behind && ahead ? "identical" : behind ? "behind" : ahead ? "ahead" : "diverged",
					files: lines(git(state, "diff", "--name-only", left(), head)).map((filename) => ({
						filename,
					})),
				};
			},
		};
	}
	if (route === "branches/main" && method === "GET") {
		exact("branch");
		return {
			kind: "branch",
			answer: () => ({name: "main", protected: (state.story.rule ?? "none") !== "none"}),
		};
	}
	m = /^git\/commits\/([0-9a-f]{40})$/.exec(route);
	if (m !== null && method === "GET") {
		exact("commit_read");
		return {
			kind: "commit_read",
			answer: () => ({sha: m[1], tree: {sha: git(state, "rev-parse", `${m[1]}^{tree}`)}}),
		};
	}
	if (route === "git/commits" && method === "POST") {
		exact("commit_make");
		const parents = fields.filter(([key]) => key === "parents[]").map(([, value]) => value);
		const message = field(fields, "message");
		const tree = field(fields, "tree");
		if (message === undefined || tree === undefined || parents.length === 0)
			throw new Unknown("commit_make: fields");
		return {
			kind: "commit_make",
			answer: () => {
				const sha = git(
					state,
					"commit-tree",
					tree,
					...parents.flatMap((parent) => ["-p", parent]),
					"-m",
					message,
				);
				return {sha, tree: {sha: tree}};
			},
		};
	}
	if (route === "git/refs/heads/main" && method === "PATCH") {
		exact("ref_move");
		const sha = field(fields, "sha");
		if (sha === undefined || field(fields, "force") !== "false" || fields.length !== 2)
			throw new Unknown("ref_move: fields");
		return {
			kind: "ref_move",
			answer: () => {
				if ((state.story.rule ?? "none") !== "none")
					throw new Refused("gh: Protected branch update failed (HTTP 422)");
				if (!isAncestor(state, mainTip(state), sha))
					throw new Refused("gh: Update is not a fast forward (HTTP 422)");
				git(state, "update-ref", "refs/heads/main", sha);
				// GitHub marks a pull request merged some moment after the ref moves. In this story, that
				// moment comes after the run has ended.
				if (state.story.marksLate !== true) markLanded(state, "main", sha);
				return {object: {sha}};
			},
		};
	}
	m = /^git\/refs\/heads\/(.+)$/.exec(route);
	if (m !== null && method === "DELETE") {
		exact("ref_delete");
		const branch = m[1];
		if (branch === "main" || fields.length !== 0) throw new Unknown(`ref_delete: ${branch}`);
		return {
			kind: "ref_delete",
			text: () => {
				if (state.story.refusesBranchDelete === true)
					throw new Refused("gh: Cannot delete this protected branch (HTTP 422)");
				if (gitMaybe(state, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`) === null)
					throw new Refused("gh: Reference does not exist (HTTP 422)");
				git(state, "update-ref", "-d", `refs/heads/${branch}`);
				return "";
			},
		};
	}
	if (route === "git/ref/heads/main" && method === "GET") {
		exact("ref_read");
		return {kind: "ref_read", answer: () => ({object: {sha: mainTip(state)}})};
	}
	m = /^actions\/runs\?head_sha=([0-9a-f]{40})&per_page=100$/.exec(route);
	if (m !== null && method === "GET") {
		exact("runs");
		return {
			kind: "runs",
			answer: () => {
				const ran = settled(state) && checksNow(state).length > 0;
				const failed = checksNow(state).some((check) => check.ends === "FAILURE");
				const runs = ran
					? [
							{
								id: RUN,
								head_sha: m[1],
								status: "completed",
								conclusion: failed ? "failure" : "success",
								run_attempt: state.attempt,
							},
						]
					: [];
				return {total_count: runs.length, workflow_runs: runs};
			},
		};
	}
	if (route === `actions/runs/${RUN}/rerun-failed-jobs` && method === "POST") {
		exact("rerun");
		return {
			kind: "rerun",
			text: () => {
				state.attempt += 1;
				return "";
			},
		};
	}
	if (route === `actions/runs/${RUN}` && method === "GET") {
		exact("run_read");
		return {kind: "run_read", answer: () => ({status: "completed", run_attempt: state.attempt})};
	}
	return null;
};

/** A compare names a branch or a commit: a branch by its whole ref, so a tag can never answer. */
const gitRef = (state, name) =>
	gitMaybe(state, "rev-parse", "--verify", "--quiet", `refs/heads/${name}`) === null
		? name
		: `refs/heads/${name}`;

// ---------------------------------------------------------------- `gh pr create`

/** A `gh pr` command's flags: exactly these, each with a value, in the lane's repository and into main. */
const readFlags = (what, names, args, state) => {
	const flags = {};
	for (let at = 0; at < args.length; at += 2) {
		const name = args[at];
		if (!names.includes(name) || args[at + 1] === undefined)
			throw new Unknown(`${what}: flag ${name}`);
		flags[name] = args[at + 1];
	}
	if (names.some((name) => flags[name] === undefined)) throw new Unknown(`${what}: a flag missing`);
	if (flags["--repo"] !== state.repo) throw new Unknown(`${what}: repo ${flags["--repo"]}`);
	if (flags["--base"] !== "main") throw new Unknown(`${what}: base ${flags["--base"]}`);
	return flags;
};

const pullsUrl = (state) => `https://github.com/${state.repo}/pull`;

/**
 * `gh pr list`, as its help documents it: `--head` names a branch and cannot name an owner, so a
 * fork's pull request on a branch of the same name is listed too, marked `isCrossRepository`.
 */
const prList = (state, args) => {
	const flags = readFlags("pr list", ["--repo", "--head", "--base", "--state", "--json"], args, state);
	if (flags["--state"] !== "open") throw new Unknown(`pr list: state ${flags["--state"]}`);
	if (flags["--json"] !== "url,isCrossRepository") throw new Unknown(`pr list: json ${flags["--json"]}`);
	return {
		kind: "pr_list",
		answer: () => [
			...(state.story.forkOn === flags["--head"]
				? [{url: `${pullsUrl(state)}/900`, isCrossRepository: true}]
				: []),
			...state.pulls
				.filter((pull) => pull.branch === flags["--head"] && pull.state === "OPEN")
				.map((pull) => ({url: `${pullsUrl(state)}/${pull.number}`, isCrossRepository: false})),
		],
	};
};

const prCreate = (state, args) => {
	const flags = readFlags("pr create", ["--repo", "--base", "--head", "--title", "--body"], args, state);
	return {
		kind: "pr_create",
		text: () => {
			const branch = flags["--head"];
			const head = gitMaybe(state, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
			if (head === null)
				throw new Refused(`pull request create failed: no branch ${branch} on the remote`);
			if (state.pulls.some((pull) => pull.branch === branch && pull.state === "OPEN"))
				throw new Refused(`a pull request for branch "${branch}" already exists`);
			const number = state.pulls.length + 1;
			state.pulls.push({
				number,
				id: `PR_${number}`,
				branch,
				base: "main",
				title: flags["--title"],
				body: flags["--body"],
				state: "OPEN",
				left: git(state, "merge-base", mainTip(state), head),
				mergedHead: null,
				mergeCommit: null,
				comments: [],
			});
			return state.story.createSays ?? `${pullsUrl(state)}/${number}\n`;
		},
	};
};

// ---------------------------------------------------------------- reading one call

/** `gh api`'s arguments. Anything but the flags the code uses is not known. */
const readApi = (args) => {
	const fields = [];
	const headers = [];
	let method = null;
	let jq = null;
	let path = null;
	for (let at = 0; at < args.length; at += 1) {
		const arg = args[at];
		if (arg === "--method") method = args[++at];
		else if (arg === "--jq") jq = args[++at];
		else if (arg === "-H") headers.push(args[++at]);
		else if (arg === "-f" || arg === "-F") {
			const kept = args[++at];
			const eq = kept.indexOf("=");
			if (eq < 1) throw new Unknown(`a field with no name: ${kept}`);
			fields.push([kept.slice(0, eq), kept.slice(eq + 1)]);
		} else if (arg.startsWith("-")) throw new Unknown(`a flag it does not know: ${arg}`);
		else if (path === null) path = arg;
		else throw new Unknown(`a second path: ${arg}`);
	}
	if (path === null) throw new Unknown("api with no path");
	// As `gh` does: a call with fields is a POST unless it says otherwise.
	return {path, method: method ?? (fields.length > 0 ? "POST" : "GET"), fields, jq, headers};
};

const route = (state, args) => {
	if (args[0] === "pr" && args[1] === "create") return prCreate(state, args.slice(2));
	if (args[0] === "pr" && args[1] === "list") return prList(state, args.slice(2));
	if (args[0] !== "api") throw new Unknown(`not a call it knows: ${args.slice(0, 2).join(" ")}`);
	const api = readApi(args.slice(1));
	if (api.path === "graphql") {
		if (api.method !== "POST" || api.jq !== null || api.headers.length > 0)
			throw new Unknown("graphql with flags it does not know");
		return graphql(state, api.fields);
	}
	const found = rest(state, api.method, api.path, api);
	if (found === null) throw new Unknown(`no such route: ${api.method} ${api.path}`);
	return found;
};

// ---------------------------------------------------------------- one run of it

const lock = () => {
	for (let tries = 0; tries < 2_000; tries += 1) {
		try {
			mkdirSync(LOCK);
			return;
		} catch {
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
		}
	}
	throw new Error("the stand-in gh could not take its lock");
};

const args = process.argv.slice(2);
/** A row's arguments: a query's text says nothing its `kind` does not. */
const told = args.map((arg) => (arg.startsWith("query=") ? "query=..." : arg));
const record = (row) => appendFileSync(CALLS, `${JSON.stringify(row)}\n`);

lock();
let code = 0;
try {
	const state = JSON.parse(readFileSync(STATE, "utf8"));
	try {
		const call = route(state, args);
		const said = call.text === undefined ? `${JSON.stringify(call.answer())}\n` : call.text();
		writeFileSync(`${STATE}.next`, JSON.stringify(state, null, 1));
		renameSync(`${STATE}.next`, STATE);
		record({kind: call.kind, args: told, rollup: rollupState(state), refused: false});
		process.stdout.write(said);
	} catch (error) {
		if (error instanceof Refused) {
			record({
				kind: refusedKind(args) ?? "refused",
				args: told,
				rollup: rollupState(state),
				refused: true,
			});
			process.stdout.write(error.out);
			process.stderr.write(`${error.message}\n`);
			code = 1;
		} else {
			// Its own break counts as unknown too: a run must not pass over a call it could not answer.
			record({kind: "unknown", args, says: error.message, rollup: null, refused: false});
			process.stderr.write(`the stand-in gh does not know this call: ${error.message}\n`);
			code = 4;
		}
	}
} finally {
	rmdirSync(LOCK);
}
process.exitCode = code;

/** Which call a refusal answered, for the record. */
function refusedKind(called) {
	if (called[0] === "pr") return "pr_create";
	const query = called.find((arg) => arg.startsWith("query="));
	if (query !== undefined) return queryKind(query.slice("query=".length));
	const path = called.find((arg) => arg.startsWith("repos/"));
	if (called.includes("DELETE")) return "ref_delete";
	return path?.endsWith("/git/refs/heads/main") ? "ref_move" : null;
}
