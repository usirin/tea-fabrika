// Experiment 111's fake issue host: one repository (`example/repo`), its issues, their labels and
// comments. It runs in the harness process, so it outlives every host the harness kills.
//
// It keeps GitHub's own rules and no more: a label an issue has already is not added twice, a
// closed issue stays closed, and a comment sent twice is two comments. It does not dedupe by key:
// the key is only logged. Every write is one line in `log`, with its key, the name and fence it was
// sent under, and whether that fence held the name's lease when the write arrived (`late`: it did
// not). As 104's fake code host (../104-stages-on-tea-host/fake-github.ts).
//
// Node at the edge, as the other harnesses: node:http.
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import type {AddressInfo} from "node:net";
import type {LeaseOf, WriteLine} from "../104-stages-on-tea-host/fake-github.ts";

export const REPO = "example/repo";
export const issueUrl = (n: number) => `https://github.com/${REPO}/issues/${n}`;

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

/** An issue as a run starts with it. */
export interface Seed {
	readonly number: number;
	readonly title: string;
	readonly body: string;
	readonly state?: "open" | "closed";
	readonly comments?: readonly string[];
}

export const startFakeIssues = async (o: {readonly leaseOf: LeaseOf}) => {
	let issues = new Map<string, Issue>();
	let log: WriteLine[] = [];

	/** A fresh world for one run: these issues, an empty log. */
	const reset = (seeds: readonly Seed[]) => {
		issues = new Map(
			seeds.map((s) => [
				issueUrl(s.number),
				{
					number: s.number,
					url: issueUrl(s.number),
					title: s.title,
					body: s.body,
					state: s.state ?? "open",
					reason: s.state === "closed" ? "not_planned" : null,
					labels: [],
					comments: [...(s.comments ?? [])],
				},
			]),
		);
		log = [];
	};
	reset([]);

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

	type Args = Record<string, unknown>;
	const str = (a: Args, k: string) => String(a[k] ?? "");
	const issueOf = (a: Args) => issues.get(str(a, "issue"));
	const calls: Record<string, (a: Args) => unknown> = {
		issue: (a) => {
			const i = issueOf(a);
			return i === undefined
				? null
				: {number: i.number, title: i.title, body: i.body, state: i.state};
		},
		/** Every issue, newest first, with its comments. */
		list: () =>
			[...issues.values()]
				.sort((x, y) => y.number - x.number)
				.map((i) => ({number: i.number, title: i.title, state: i.state, comments: i.comments})),
		hasComment: (a) =>
			(issueOf(a)?.comments ?? []).some((c) =>
				c.includes(`<!-- fabrika-key: ${str(a, "key")} -->`),
			),
		labels: (a) => issueOf(a)?.labels ?? null,
		closed: (a) => (issueOf(a) === undefined ? null : issueOf(a)?.state === "closed"),
	};
	const missing = {applied: false, why: "no such issue", answer: {ok: false}};
	const writes: Record<
		string,
		(a: Args) => {applied: boolean; why: string | null; answer: unknown}
	> = {
		comment: (a) => {
			const i = issueOf(a);
			if (i === undefined) return missing;
			i.comments.push(str(a, "body"));
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
		return reply(res, 404, {error: `no ${fn}`});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		url,
		reset,
		log: () => log,
		/** The issues as a run left them: state, close reason, labels, and each comment's text. */
		world: () =>
			[...issues.values()].map((i) => ({
				number: i.number,
				state: i.state,
				reason: i.reason,
				labels: [...i.labels].sort(),
				comments: i.comments,
			})),
		close: () => new Promise<void>((r) => server.close(() => r())),
	};
};
export type FakeIssues = Awaited<ReturnType<typeof startFakeIssues>>;
