// Experiment 148's laptop side: a terminal that talks to tsh in the project's host. The laptop
// keeps the line editor; a whole line goes up, and what tsh prints comes down.
//
//   node attach.ts http://localhost:1337 p1 <session>
//   tsh$ counter &
//   [1] counter:...
//
//   up:    {type: "line", text: "counter &"}
//   down:  {type: "opened", ms, attached, born}   the host opened this person's tsh (a wake)
//          {type: "printed", text}                 what tsh printed
//          {type: "ready"}                         the prompt is back
//
// Used by the driver as a library (`attach`), and by a person as a command. Node at the edge:
// Node's own WebSocket and readline.
import {createInterface} from "node:readline";

export interface Down {
	readonly type: string;
	readonly text?: string;
	readonly ms?: number;
	readonly attached?: readonly number[];
	readonly born?: number;
	readonly fresh?: boolean;
}

export interface Client {
	readonly heard: Down[];
	/** Everything printed so far, as one text. */
	readonly printed: () => string;
	readonly line: (text: string) => void;
	/** Wait until something heard since `from` passes `test`. */
	readonly until: (test: (m: Down) => boolean, ms?: number, from?: number) => Promise<Down>;
	readonly close: () => void;
	readonly closed: Promise<void>;
}

export const attach = (base: string, project: string, session: string): Promise<Client> =>
	new Promise((resolve, reject) => {
		const url = `${base.replace(/^http/, "ws")}/p/${project}/attach?session=${encodeURIComponent(session)}`;
		const ws = new WebSocket(url);
		const heard: Down[] = [];
		const waiters = new Set<() => void>();
		let done: () => void = () => {};
		const closed = new Promise<void>((r) => {
			done = r;
		});
		ws.addEventListener("message", (e) => {
			heard.push(JSON.parse(String(e.data)) as Down);
			for (const w of [...waiters]) w();
		});
		ws.addEventListener("close", () => done());
		ws.addEventListener("error", () => reject(new Error(`could not attach to ${base}`)));
		ws.addEventListener("open", () =>
			resolve({
				heard,
				printed: () =>
					heard
						.filter((m) => m.type === "printed")
						.map((m) => m.text)
						.join(""),
				line: (text) => ws.send(JSON.stringify({type: "line", text})),
				until: (test, ms = 15000, from = 0) =>
					new Promise((ok, fail) => {
						const look = () => {
							const hit = heard.slice(from).find(test);
							if (hit === undefined) return false;
							waiters.delete(look);
							clearTimeout(timer);
							ok(hit);
							return true;
						};
						const timer = setTimeout(() => {
							waiters.delete(look);
							fail(new Error(`not heard in ${ms} ms`));
						}, ms);
						waiters.add(look);
						look();
					}),
				close: () => ws.close(),
				closed,
			}),
		);
	});

if (import.meta.main) {
	const [base = "http://localhost:1337", project = "p1", session = ""] = process.argv.slice(2);
	const client = await attach(base, project, session);
	let seen = 0;
	const show = () => {
		for (const m of client.heard.slice(seen)) {
			if (m.type === "printed") process.stdout.write(m.text ?? "");
			if (m.type === "ready") process.stdout.write("tsh$ ");
		}
		seen = client.heard.length;
	};
	setInterval(show, 50);
	const rl = createInterface({input: process.stdin});
	rl.on("line", (text) => client.line(text));
	rl.on("close", () => client.close());
	await client.closed;
	show();
	process.exit(0);
}
