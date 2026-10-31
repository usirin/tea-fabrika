// The app's end of the link to the host (apps/fabrika/src/link.ts), by hand: JSON Lines on the
// host's Unix socket, with Node's own `net`. No app code: an experiment never imports an app. It
// speaks only what link.ts says goes over the wire, so a change to the wire breaks it loudly.
//
//   const link = await openLink(sock);       // connected, nothing said yet
//   link.send({type: "hello", version: 1});
//   await link.until((m) => m.type === "hello", 2000);
//   link.ended                               // a promise: performance.now() when the socket closed
//   link.close();
//
// Node at the edge, all of it: this is a test client for a measurement.
import {connect, type Socket} from "node:net";

/** One line the host sent, as JSON. */
export type Line = {readonly type: string} & Record<string, unknown>;

export interface Link {
	readonly socket: Socket;
	/** Every line the host sent, in order. */
	readonly got: Line[];
	readonly send: (m: unknown) => void;
	/** The first line, from `from` on, that `test` takes; rejects after `ms`, or if the socket ends first. */
	readonly until: (test: (m: Line) => boolean, ms: number, from?: number) => Promise<Line>;
	/** When the socket closed, by `performance.now()`. */
	readonly ended: Promise<number>;
	readonly close: () => void;
}

/** Connect to `sock`. Rejects with Node's error (its `code`: ENOENT, ECONNREFUSED) when nothing listens. */
export const openLink = (sock: string): Promise<Link> =>
	new Promise((resolve, reject) => {
		const socket = connect({path: sock});
		const got: Line[] = [];
		const waiters = new Set<() => void>();
		let rest = "";
		let over = false;
		let endedAt = 0;
		const ended = new Promise<number>((done) => {
			socket.once("close", () => {
				over = true;
				endedAt = performance.now();
				done(endedAt);
				for (const w of waiters) w();
			});
		});
		socket.on("data", (chunk) => {
			rest += chunk.toString("utf8");
			let nl = rest.indexOf("\n");
			while (nl >= 0) {
				const text = rest.slice(0, nl);
				rest = rest.slice(nl + 1);
				if (text !== "") got.push(JSON.parse(text) as Line);
				nl = rest.indexOf("\n");
			}
			for (const w of waiters) w();
		});
		const until = (test: (m: Line) => boolean, ms: number, from = 0) =>
			new Promise<Line>((ok, fail) => {
				let looked = from;
				const look = () => {
					for (; looked < got.length; looked += 1) {
						const m = got[looked];
						if (m !== undefined && test(m)) {
							stop();
							ok(m);
							return;
						}
					}
					if (over) {
						stop();
						fail(new Error("the socket closed first"));
					}
				};
				const timer = setTimeout(() => {
					stop();
					fail(new Error(`no such line within ${ms} ms`));
				}, ms);
				const stop = () => {
					clearTimeout(timer);
					waiters.delete(look);
				};
				waiters.add(look);
				look();
			});
		socket.once("connect", () => {
			socket.off("error", reject);
			socket.on("error", () => {});
			resolve({
				socket,
				got,
				send: (m) => socket.write(`${JSON.stringify(m)}\n`),
				until,
				ended,
				close: () => socket.destroy(),
			});
		});
		socket.once("error", reject);
	});

/** What answers on `sock`, as the app's `reach` (apps/fabrika/src/host/socket.ts) asks it. */
export const reach = async (sock: string): Promise<"live" | "absent" | "stale"> => {
	try {
		const link = await openLink(sock);
		link.close();
		return "live";
	} catch (e) {
		const code = (e as {code?: unknown}).code;
		if (code === "ENOENT") return "absent";
		if (code === "ECONNREFUSED" || code === "ENOTSOCK") return "stale";
		throw e;
	}
};
