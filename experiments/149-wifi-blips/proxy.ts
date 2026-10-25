// Experiment 149's link: a small TCP proxy between host A and the ledger (and its fake code host)
// that can drop the link on command, two ways.
//
//   pass     bytes go both ways, as they come.
//   refuse   a clean refusal. Every open connection is reset, and the port stops listening, so a
//            new connect answers ECONNREFUSED at once. What a laptop sees when its interface is
//            down: the error comes back fast.
//   hang     a silent hang, what wifi really does. Connections stay open and new ones are
//            accepted, but no byte moves either way. Bytes are held, in order, and go out when the
//            link is back, as TCP would send them again. A connection the client closed while
//            the link hung still gets its held bytes to the ledger, then its end: the client's
//            kernel keeps sending what was written before the close. So a request that timed out
//            on the client can still land, late. Bytes the ledger sent to a client that left are
//            dropped.
//
// Not modelled: TCP's own retransmit backoff. A real socket that had bytes in flight during a
// long hang may wait up to its next retransmit (1, 3, 7, 15, 31, 63 s ...) after the link is
// back; here held bytes go at once. It matters only for a socket kept across the hang.
//
// Node at the edge: node:net. It counts what it saw, for the harness.
import {connect, createServer, type Server, type Socket} from "node:net";

export type Mode = "pass" | "refuse" | "hang";

export interface ProxyCounts {
	/** Connections accepted, in all. */
	conns: number;
	/** Of those, WebSocket upgrades (the doorbell). */
	sockets: number;
	/** Connections reset by a refuse. */
	reset: number;
	/** Client connections that closed during a hang and still had bytes delivered upstream after it. */
	late: number;
	/** Connect attempts refused while the port was closed (seen as no listener: counted by the client). */
	refusals: number;
}

interface Pair {
	readonly down: Socket;
	readonly up: Socket;
	/** Held while hanging: client to ledger, and ledger to client. */
	toUp: Buffer[];
	toDown: Buffer[];
	/** The client ended during a hang: send `toUp`, then end upstream. */
	downEnded: boolean;
	upEnded: boolean;
	first: boolean;
}

export class LinkProxy {
	readonly counts: ProxyCounts = {conns: 0, sockets: 0, reset: 0, late: 0, refusals: 0};
	private mode: Mode = "pass";
	private server: Server | null = null;
	private readonly pairs = new Set<Pair>();
	/** The open doorbells, by the pair. */
	private readonly bells = new Set<Pair>();

	readonly port: number;
	readonly target: {readonly host: string; readonly port: number};

	constructor(port: number, target: {readonly host: string; readonly port: number}) {
		this.port = port;
		this.target = target;
	}

	get now(): Mode {
		return this.mode;
	}

	/** Doorbells open right now. */
	get openBells(): number {
		return this.bells.size;
	}

	async start(): Promise<void> {
		await this.listen();
	}

	async set(mode: Mode): Promise<void> {
		const was = this.mode;
		if (was === mode) return;
		this.mode = mode;
		if (mode === "refuse") {
			for (const p of this.pairs) {
				this.counts.reset++;
				p.down.resetAndDestroy();
				p.up.destroy();
			}
			this.pairs.clear();
			this.bells.clear();
			await this.unlisten();
			return;
		}
		if (was === "refuse") await this.listen();
		if (mode === "pass") for (const p of [...this.pairs]) this.flush(p);
	}

	async stop(): Promise<void> {
		for (const p of this.pairs) {
			p.down.destroy();
			p.up.destroy();
		}
		this.pairs.clear();
		await this.unlisten();
	}

	private listen(): Promise<void> {
		const server = createServer((down) => this.accept(down));
		this.server = server;
		return new Promise((ok, fail) => {
			server.once("error", fail);
			server.listen(this.port, "127.0.0.1", () => ok());
		});
	}

	private unlisten(): Promise<void> {
		const server = this.server;
		this.server = null;
		if (server === null) return Promise.resolve();
		return new Promise((ok) => server.close(() => ok()));
	}

	private accept(down: Socket) {
		this.counts.conns++;
		const up = connect(this.target.port, this.target.host);
		const p: Pair = {
			down,
			up,
			toUp: [],
			toDown: [],
			downEnded: false,
			upEnded: false,
			first: true,
		};
		this.pairs.add(p);
		down.setNoDelay(true);
		up.setNoDelay(true);
		const gone = () => {
			this.pairs.delete(p);
			this.bells.delete(p);
		};
		down.on("data", (b: Buffer) => {
			if (p.first) {
				p.first = false;
				if (b.subarray(0, 512).toString("latin1").toLowerCase().includes("upgrade: websocket")) {
					this.counts.sockets++;
					this.bells.add(p);
				}
			}
			if (this.mode === "pass") up.write(b);
			else p.toUp.push(b);
		});
		up.on("data", (b: Buffer) => {
			if (this.mode === "pass") down.write(b);
			else p.toDown.push(b);
		});
		down.on("end", () => {
			p.downEnded = true;
			if (this.mode === "pass") up.end();
		});
		up.on("end", () => {
			p.upEnded = true;
			if (this.mode === "pass") down.end();
		});
		down.on("close", () => {
			// The client left. While hanging, what it wrote still goes to the ledger once the link is back.
			if (this.mode === "hang") {
				p.downEnded = true;
				if (p.toUp.length > 0) this.counts.late++;
				return;
			}
			if (this.mode === "pass") up.end();
			gone();
		});
		up.on("close", () => {
			if (this.mode === "pass") down.destroy();
			if (this.mode !== "hang") gone();
		});
		down.on("error", () => {});
		up.on("error", () => {});
	}

	/** The link is back: what was held goes, in order. */
	private flush(p: Pair) {
		for (const b of p.toUp) if (!p.up.destroyed) p.up.write(b);
		p.toUp = [];
		if (p.down.destroyed) {
			p.toDown = [];
			if (!p.up.destroyed) p.up.end();
			this.pairs.delete(p);
			this.bells.delete(p);
			return;
		}
		for (const b of p.toDown) p.down.write(b);
		p.toDown = [];
		if (p.downEnded && !p.up.destroyed) p.up.end();
		if (p.upEnded) p.down.end();
	}
}
