// Experiment 105's fake GitHub: one repository (`example/repo`), its issues and pull requests (one
// kind of thing, as on GitHub: a pull request is an issue with a branch), a merge queue, the checks
// it runs, and a bare git repository on disk that hosts push to. It runs in the harness process, so
// it outlives every host the harness kills. The calls are 104's and 111's, on one server.
//
// It keeps GitHub's own rules and no more:
//
//   - one open pull request per branch; a push that is not a fast-forward is refused
//   - the checks run on a pull request's head when it opens, and again on each push to its branch
//     while it is open: `ci` counts the runs, per pull request
//   - a queued pull request lands 300 ms after its enqueue: a real merge commit on main, made from
//     main as it is then. A pull request that merges closes every issue its body names with
//     `Closes #N`
//   - a label an issue has is not added twice, a closed issue stays closed, a comment sent twice
//     is two comments
//
// It does not dedupe by key: the key is only logged. Every write is one line in `log`, with its key,
// the name and fence it was sent under, and whether that fence held the name's lease when the write
// arrived (`late`: it did not).
//
// Node at the edge, as the other harnesses: node:http, and git through execFileSync.
import {execFileSync} from "node:child_process";
import {mkdtempSync} from "node:fs";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import type {AddressInfo} from "node:net";
import {join} from "node:path";
import type {LeaseOf, WriteLine} from "../104-stages-on-tea-host/fake-github.ts";

export const REPO = "example/repo";
export const issueUrl = (n: number) => `https://github.com/${REPO}/issues/${n}`;
const prUrl = (n: number) => `https://github.com/${REPO}/pull/${n}`;
const LAND_MS = 300;

export interface Issue {
	readonly number: number;
	readonly url: string;
	readonly title: string;
	readonly body: string;
	state: "open" | "closed";
	reason: string | null;
	readonly labels: string[];
	readonly comments: string[];
}

export interface Pr {
	readonly url: string;
	readonly number: number;
	readonly branch: string;
	head: string;
	state: "open" | "merged";
	queued: string | null;
	commit: string | null;
	readonly title: string;
	readonly body: string;
	readonly comments: string[];
	/** The heads the checks ran on, in order. */
	readonly ci: string[];
}

/** One landing on main: the head, main as it stood, whether the head held that main, whether it had passed. */
export interface Landing {
	readonly pr: string;
	readonly head: string;
	readonly onto: string;
	readonly tested: boolean;
	readonly passed: boolean;
}

/** An issue as a run starts with it, or as the harness files it. */
export interface Seed {
	readonly number: number;
	readonly title: string;
	readonly body: string;
	readonly state?: "open" | "closed";
	readonly comments?: readonly string[];
}

const GIT = ["-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat"];
const ME = ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com"];
export const git = (args: readonly string[], cwd?: string) =>
	execFileSync("git", [...GIT, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		...(cwd === undefined ? {} : {cwd}),
	}).trim();
const tryGit = (args: readonly string[], cwd?: string): string | null => {
	try {
		return git(args, cwd);
	} catch {
		return null;
	}
};

export const startFake = async (o: {readonly dir: string; readonly leaseOf: LeaseOf}) => {
	let runs = 0;
	let bare = "";
	let issues = new Map<string, Issue>();
	let prs = new Map<string, Pr>();
	let log: WriteLine[] = [];
	let landings: Landing[] = [];
	let next = 800;

	/** A fresh world for one run: a new bare repository cloned from `template`, these issues. */
	const reset = (template: string, seeds: readonly Seed[]) => {
		runs++;
		bare = join(o.dir, `repo-${runs}.git`);
		git(["clone", "-q", "--bare", template, bare]);
		git(["-C", bare, "config", "core.logAllRefUpdates", "always"]);
		git(["-C", bare, "config", "receive.denyNonFastForwards", "true"]);
		issues = new Map();
		for (const s of seeds) file(s);
		prs = new Map();
		log = [];
		landings = [];
		next = 800;
	};
	/** File one issue, as someone does on GitHub. */
	const file = (s: Seed) => {
		issues.set(issueUrl(s.number), {
			number: s.number,
			url: issueUrl(s.number),
			title: s.title,
			body: s.body,
			state: s.state ?? "open",
			reason: s.state === "closed" ? "completed" : null,
			labels: [],
			comments: [...(s.comments ?? [])],
		});
	};

	const branchHead = (branch: string): string | null => {
		const out = git(["-C", bare, "for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`]);
		return out === "" ? null : out;
	};
	const mainHead = () => branchHead("main") ?? "";
	/** Every head a branch had, oldest first, from the bare repository's reflog. */
	const history = (branch: string): string[] => {
		if (branchHead(branch) === null) return [];
		const out = git(["-C", bare, "reflog", "show", "--format=%H", `refs/heads/${branch}`, "--"]);
		return out === "" ? [] : out.split("\n").reverse();
	};
	/** Pushes to a branch that did not move it forward from where it stood: rebases and force-pushes. */
	const rewrites = (branch: string): number => {
		const heads = history(branch);
		let n = 0;
		for (let i = 1; i < heads.length; i++)
			if (
				tryGit(["-C", bare, "merge-base", "--is-ancestor", heads[i - 1] ?? "", heads[i] ?? ""]) ===
				null
			)
				n++;
		return n;
	};

	/** Main moves on: `change` edits a copy of main, which is committed and pushed as one commit. */
	const moveMain = (message: string, change: (tree: string) => void) => {
		const tree = mkdtempSync(join(o.dir, "main-"));
		git(["clone", "-q", bare, tree]);
		change(tree);
		git(["add", "-A"], tree);
		git([...ME, "commit", "-q", "-m", message], tree);
		git(["push", "-q", "origin", "HEAD:main"], tree);
		return mainHead();
	};

	const write = async (
		op: string,
		k: {key: string | null; name: string | null; fence: number | null},
		apply: () => {applied: boolean; why: string | null; answer: unknown},
	) => {
		const lease = k.name === null ? null : await o.leaseOf(k.name);
		const late =
			k.name !== null &&
			(lease === null || lease.fence !== k.fence || lease.expiresAt < Date.now());
		const done = apply();
		log.push({op, ...k, at: Date.now(), applied: done.applied, why: done.why, late});
		return done.answer;
	};

	/** The pull request carries a passing review verdict for this head. */
	const passedAt = (p: Pr, head: string) =>
		p.comments.some((c) => c.startsWith(`review-code: PASS @ ${head}`));

	/** A pull request lands: a merge commit on main as it is now, then the issues it names close. */
	const landNow = (pr: Pr, head: string): string | null => {
		const onto = mainHead();
		landings.push({
			pr: pr.url,
			head,
			onto,
			tested: tryGit(["-C", bare, "merge-base", "--is-ancestor", onto, head]) !== null,
			passed: passedAt(pr, head),
		});
		const tree = mkdtempSync(join(o.dir, "land-"));
		git(["clone", "-q", bare, tree]);
		const merged = tryGit(
			[...ME, "merge", "--no-ff", "-q", "-m", `Merge pull request #${pr.number}`, head],
			tree,
		);
		if (merged === null) return null;
		git(["push", "-q", "origin", "HEAD:main"], tree);
		pr.state = "merged";
		pr.commit = mainHead();
		pr.queued = null;
		for (const m of pr.body.matchAll(/^Closes #(\d+)$/gm)) {
			const i = issues.get(issueUrl(Number(m[1])));
			if (i !== undefined && i.state === "open") {
				i.state = "closed";
				i.reason = "completed";
			}
		}
		return pr.commit;
	};
	const land = (pr: Pr, head: string) =>
		setTimeout(() => {
			if (pr.state !== "open" || pr.queued !== head) return;
			if (landNow(pr, head) === null) pr.queued = null;
		}, LAND_MS);

	type Args = Record<string, unknown>;
	const str = (a: Args, k: string) => String(a[k] ?? "");
	/** An issue or a pull request, by its url: comments go to either. */
	const thread = (a: Args) => {
		const url = str(a, a.pr === undefined ? "issue" : "pr");
		return prs.get(url) ?? issues.get(url);
	};
	const issueOf = (a: Args) => issues.get(str(a, "issue"));
	const calls: Record<string, (a: Args) => unknown> = {
		// ---------------------------------------- issues
		issue: (a) => {
			const i = issueOf(a);
			return i === undefined
				? null
				: {number: i.number, title: i.title, body: i.body, state: i.state};
		},
		list: () =>
			[...issues.values()]
				.sort((x, y) => y.number - x.number)
				.map((i) => ({number: i.number, title: i.title, state: i.state, comments: i.comments})),
		labels: (a) => issueOf(a)?.labels ?? null,
		closed: (a) => (issueOf(a) === undefined ? null : issueOf(a)?.state === "closed"),
		hasComment: (a) =>
			(thread(a)?.comments ?? []).some((c) => c.includes(`<!-- fabrika-key: ${str(a, "key")} -->`)),
		// ---------------------------------------- code
		prFrom: (a) =>
			[...prs.values()].find((p) => p.branch === str(a, "branch") && p.state === "open")?.url ??
			null,
		pr: (a) => prs.get(str(a, "pr")) ?? null,
		branchHead: (a) => branchHead(str(a, "branch")),
		landing: (a) => {
			const p = prs.get(str(a, "pr"));
			if (p === undefined) return {at: "none"};
			if (p.state === "merged" && p.commit !== null) return {at: "merged", commit: p.commit};
			return p.queued === str(a, "head") ? {at: "queued"} : {at: "none"};
		},
		/** What ship reads of a pull request at its head. */
		shipFacts: (a) => {
			const p = prs.get(str(a, "pr"));
			if (p === undefined) return null;
			const tip = mainHead();
			const tested = tryGit(["-C", bare, "merge-base", tip, p.head]) ?? "";
			const passed = passedAt(p, p.head);
			return {
				head: p.head,
				state: p.state,
				checks: p.ci.includes(p.head) ? "green" : "pending",
				passed,
				main: {tested, tip},
			};
		},
	};
	const missing = {applied: false, why: "no such issue", answer: {ok: false}};
	const writes: Record<
		string,
		(a: Args) => {applied: boolean; why: string | null; answer: unknown}
	> = {
		comment: (a) => {
			const t = thread(a);
			if (t === undefined) return missing;
			t.comments.push(str(a, "body"));
			return {applied: true, why: null, answer: {ok: true}};
		},
		label: (a) => {
			const i = issueOf(a);
			if (i === undefined) return missing;
			const label = str(a, "label");
			if (i.labels.includes(label)) return {applied: false, why: "has it", answer: {ok: true}};
			i.labels.push(label);
			return {applied: true, why: null, answer: {ok: true}};
		},
		close: (a) => {
			const i = issueOf(a);
			if (i === undefined) return missing;
			if (i.state === "closed") return {applied: false, why: "closed", answer: {ok: true}};
			i.state = "closed";
			i.reason = str(a, "reason");
			return {applied: true, why: null, answer: {ok: true}};
		},
		push: (a) => {
			const branch = str(a, "branch");
			const before = branchHead(branch);
			const pushed = tryGit([
				"-C",
				str(a, "tree"),
				"push",
				"-q",
				"--no-verify",
				bare,
				`${str(a, "sha")}:refs/heads/${branch}`,
			]);
			if (pushed === null) return {applied: false, why: "rejected", answer: {ok: false}};
			const after = branchHead(branch);
			if (before !== after && after !== null) {
				const open = [...prs.values()].find((p) => p.branch === branch && p.state === "open");
				if (open !== undefined) {
					open.head = after;
					open.ci.push(after);
				}
			}
			return {
				applied: before !== after,
				why: before === after ? "up_to_date" : null,
				answer: {ok: true},
			};
		},
		open: (a) => {
			const branch = str(a, "branch");
			if ([...prs.values()].some((p) => p.branch === branch && p.state === "open"))
				return {
					applied: false,
					why: "a pull request already exists for this branch",
					answer: {error: 422},
				};
			const head = branchHead(branch);
			if (head === null) return {applied: false, why: "no such branch", answer: {error: 422}};
			const number = next++;
			const url = prUrl(number);
			prs.set(url, {
				url,
				number,
				branch,
				head,
				state: "open",
				queued: null,
				commit: null,
				title: str(a, "title"),
				body: str(a, "body"),
				comments: [],
				ci: [head],
			});
			return {applied: true, why: null, answer: {url}};
		},
		enqueue: (a) => {
			const p = prs.get(str(a, "pr"));
			const head = str(a, "head");
			if (p === undefined || p.state !== "open")
				return {applied: false, why: "not open", answer: {answer: "conflicts"}};
			if (p.head !== head)
				return {applied: false, why: "head moved", answer: {answer: "head_moved"}};
			if (p.queued === head)
				return {applied: false, why: "already queued", answer: {answer: "queued"}};
			p.queued = head;
			land(p, head);
			return {applied: true, why: null, answer: {answer: "queued"}};
		},
		merge: (a) => {
			const p = prs.get(str(a, "pr"));
			if (p === undefined || p.state !== "open")
				return {applied: false, why: "not open", answer: {reading: "conflicts"}};
			const commit = landNow(p, str(a, "head"));
			return commit === null
				? {applied: false, why: "conflicts", answer: {reading: "conflicts"}}
				: {applied: true, why: null, answer: {reading: "merged", commit}};
		},
		rerun: () => ({applied: true, why: null, answer: [{run: 11, attempt: 2}]}),
	};

	const reply = (res: ServerResponse, code: number, body: unknown) => {
		res.writeHead(code, {"content-type": "application/json"});
		res.end(JSON.stringify(body));
	};
	const bodyOf = (req: IncomingMessage) =>
		new Promise<string>((r) => {
			let text = "";
			req.on("data", (d: Buffer) => {
				text += d.toString();
			});
			req.on("end", () => r(text));
		});
	const server = createServer(async (req, res) => {
		const {
			fn = "",
			args = {},
			key = null,
			name = null,
			fence = null,
		} = JSON.parse(await bodyOf(req));
		const read = calls[fn];
		if (read !== undefined) return reply(res, 200, {answer: read(args)});
		const w = writes[fn];
		if (w !== undefined)
			return reply(res, 200, {answer: await write(fn, {key, name, fence}, () => w(args))});
		if (fn === "remote") return reply(res, 200, {answer: bare});
		return reply(res, 404, {error: `no ${fn}`});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		url,
		reset,
		file,
		moveMain,
		log: () => log,
		landings: () => landings,
		prs: () => [...prs.values()],
		issues: () => [...issues.values()],
		remote: () => bare,
		mainHead,
		branchHead,
		history,
		rewrites,
		close: () => new Promise<void>((r) => server.close(() => r())),
	};
};
export type Fake = Awaited<ReturnType<typeof startFake>>;
