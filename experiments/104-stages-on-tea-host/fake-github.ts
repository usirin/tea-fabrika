// Experiment 104's fake code host: one repository (`example/repo`), its pull requests, their
// comments, a merge queue, and a bare git repository on disk that hosts push to. It runs in the
// harness process, so it outlives every host the harness kills.
//
// It keeps GitHub's own rules and no more: one open pull request per branch, a push that is not a
// fast-forward is refused, an enqueue of a pull request already queued at that head changes
// nothing. It does not dedupe by key: the key is only logged. Every write is one line in `log`, with
// its key, the name and fence it was sent under, and whether that fence held the name's lease when
// the write arrived (`late`: it did not). A queued pull request lands 300 ms after its enqueue.
//
// Node at the edge, as the other harnesses: node:http, and git through execFileSync.
import {execFileSync} from "node:child_process";
import {mkdirSync} from "node:fs";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import type {AddressInfo} from "node:net";
import {join} from "node:path";

export const REPO = {owner: "example", name: "repo"} as const;
const BASE_URL = "https://github.com/example/repo/pull/";
/** A queue runs the checks again before it lands: longer than a takeover (about a lease). */
const LAND_MS = 3000;

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
}

/** One write as it reached the code host. */
export interface WriteLine {
	readonly op: string;
	/** null: a write sent with no key (a planted mistake). */
	readonly key: string | null;
	readonly name: string | null;
	readonly fence: number | null;
	readonly at: number;
	/** It changed the world. */
	readonly applied: boolean;
	readonly why: string | null;
	/** The fence it was sent under did not hold the name's lease when it arrived. */
	readonly late: boolean;
}

export type LeaseOf = (name: string) => Promise<{fence: number; expiresAt: number} | null>;

const GIT = ["-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat"];
const git = (args: readonly string[], cwd?: string) =>
	execFileSync("git", [...GIT, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		...(cwd === undefined ? {} : {cwd}),
	}).trim();

/** A template repository: main with one commit, made once per harness run. */
export const makeTemplate = (dir: string) => {
	const src = join(dir, "template-src");
	mkdirSync(src, {recursive: true});
	git(["init", "-q", "-b", "main", src]);
	execFileSync(
		"sh",
		[
			"-c",
			"printf '# repo\\n' > README.md && mkdir -p src && printf 'export const slug = (t: string) => t.replace(/ /g, \"-\");\\n' > src/slug.ts",
		],
		{cwd: src},
	);
	git(["add", "-A"], src);
	git(
		[
			"-c",
			"user.name=fixture",
			"-c",
			"user.email=fixture@example.com",
			"commit",
			"-q",
			"-m",
			"the start",
		],
		src,
	);
	return src;
};

export const startFake = async (o: {
	readonly dir: string;
	readonly template: string;
	readonly leaseOf: LeaseOf;
}) => {
	let runs = 0;
	let bare = "";
	let prs = new Map<string, Pr>();
	let log: WriteLine[] = [];
	let next = 700;

	/** A fresh world for one run: a new bare repository, no pull requests, an empty log. */
	let landMs = LAND_MS;
	const reset = (
		fixtures: readonly {branch: string; head: string; number: number}[] = [],
		timing: {readonly landMs?: number} = {},
	) => {
		runs++;
		landMs = timing.landMs ?? LAND_MS;
		bare = join(o.dir, `repo-${runs}.git`);
		git(["clone", "-q", "--bare", o.template, bare]);
		git(["-C", bare, "config", "core.logAllRefUpdates", "always"]);
		git(["-C", bare, "config", "receive.denyNonFastForwards", "true"]);
		prs = new Map();
		log = [];
		next = 700;
		for (const f of fixtures) {
			const url = `${BASE_URL}${f.number}`;
			prs.set(url, {
				url,
				number: f.number,
				branch: f.branch,
				head: f.head,
				state: "open",
				queued: null,
				commit: null,
				title: "fixture",
				body: "",
				comments: [],
			});
		}
	};
	reset();

	const mainHead = () => git(["-C", bare, "rev-parse", "refs/heads/main"]);
	const branchHead = (branch: string): string | null => {
		const out = git(["-C", bare, "for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`]);
		return out === "" ? null : out;
	};
	/** The pushes the bare repository took, per branch, from its reflog. */
	const pushes = (branch: string): number => {
		if (branchHead(branch) === null) return 0;
		const out = git(["-C", bare, "reflog", "show", "--format=%H", `refs/heads/${branch}`, "--"]);
		return out === "" ? 0 : out.split("\n").length;
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

	const land = (pr: Pr, head: string) =>
		setTimeout(() => {
			if (pr.state !== "open" || pr.queued !== head) return;
			pr.state = "merged";
			pr.commit = `m${head.slice(0, 12)}`;
			pr.queued = null;
		}, landMs);

	type Args = Record<string, unknown>;
	const str = (a: Args, k: string) => String(a[k] ?? "");
	const calls: Record<string, (a: Args) => unknown> = {
		// ---------------------------------------- reads
		prFrom: (a) =>
			[...prs.values()].find((p) => p.branch === str(a, "branch") && p.state === "open")?.url ??
			null,
		pr: (a) => prs.get(str(a, "pr")) ?? null,
		branchHead: (a) => branchHead(str(a, "branch")),
		hasComment: (a) =>
			(prs.get(str(a, "pr"))?.comments ?? []).some((c) =>
				c.includes(`<!-- fabrika-key: ${str(a, "key")} -->`),
			),
		landing: (a) => {
			const p = prs.get(str(a, "pr"));
			if (p === undefined) return {at: "none"};
			if (p.state === "merged" && p.commit !== null) return {at: "merged", commit: p.commit};
			return p.queued === str(a, "head") ? {at: "queued"} : {at: "none"};
		},
	};
	const writes: Record<
		string,
		(a: Args) => {applied: boolean; why: string | null; answer: unknown}
	> = {
		push: (a) => {
			const branch = str(a, "branch");
			const before = branchHead(branch);
			try {
				git([
					"-C",
					str(a, "tree"),
					"push",
					"-q",
					"--no-verify",
					bare,
					`${str(a, "sha")}:refs/heads/${branch}`,
				]);
			} catch {
				return {applied: false, why: "rejected", answer: {ok: false}};
			}
			const after = branchHead(branch);
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
			const url = `${BASE_URL}${number}`;
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
			});
			return {applied: true, why: null, answer: {url}};
		},
		comment: (a) => {
			const p = prs.get(str(a, "pr"));
			if (p === undefined)
				return {applied: false, why: "no such pull request", answer: {error: 404}};
			p.comments.push(str(a, "body"));
			return {applied: true, why: null, answer: {ok: true}};
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
			p.state = "merged";
			p.commit = `d${str(a, "head").slice(0, 12)}`;
			return {applied: true, why: null, answer: {reading: "merged", commit: p.commit}};
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
		log: () => log,
		prs: () => prs,
		remote: () => bare,
		mainHead,
		branchHead,
		pushes,
		close: () => new Promise<void>((r) => server.close(() => r())),
	};
};
export type Fake = Awaited<ReturnType<typeof startFake>>;
