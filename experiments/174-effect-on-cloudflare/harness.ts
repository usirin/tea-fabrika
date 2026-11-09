// Shared by every part: bundle one entry for workerd, start Miniflare, talk raw JSON over a socket.
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {build} from "esbuild";
import {Miniflare} from "miniflare";

export const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export const bundle = async (
	entry: string,
	options: {platform?: "browser" | "worker"; external?: string[]} = {},
) => {
	const browser = options.platform === "browser";
	const t0 = performance.now();
	const out = await build({
		entryPoints: [here(entry)],
		bundle: true,
		write: false,
		format: "esm",
		platform: browser ? "browser" : "neutral",
		target: "es2022",
		mainFields: ["module", "main"],
		conditions: browser ? ["browser", "import"] : ["workerd", "worker", "browser", "import"],
		external: ["cloudflare:workers", ...(options.external ?? [])],
		// EFFECT_DIST points the worker at an unpacked newer Effect, to see what a release breaks.
		...(process.env.EFFECT_DIST ? {alias: {effect: process.env.EFFECT_DIST}} : {}),
		minify: true,
		legalComments: "none",
		logLevel: "silent",
	});
	const code = out.outputFiles[0]?.text ?? "";
	return {
		code,
		bytes: Buffer.byteLength(code),
		gzip: gzipSync(code).length,
		buildMs: round(performance.now() - t0, 0),
	};
};

/** Miniflare from another folder and a chosen date, to compare runtimes. Same options otherwise. */
const startOn = async (
	miniflarePath: string | undefined,
	compatibilityDate: string,
	code: string,
	durableObjects: Record<string, string>,
) => {
	const {Miniflare: Other} = miniflarePath
		? ((await import(miniflarePath)) as {Miniflare: typeof Miniflare})
		: {Miniflare};
	return new Other({
		modules: [{type: "ESModule", path: "entry.js", contents: code}],
		compatibilityDate,
		compatibilityFlags: ["nodejs_compat"],
		durableObjects: Object.fromEntries(
			Object.entries(durableObjects).map(([k, className]) => [k, {className, useSQLite: true}]),
		),
	} as ConstructorParameters<typeof Miniflare>[0]);
};

export const start = (code: string, durableObjects: Record<string, string>) =>
	startOn(process.env.MINIFLARE_PATH, process.env.COMPAT ?? "2026-07-01", code, durableObjects);

/** A socket with nothing on top: what a browser tab has. */
export class Raw {
	frames: Array<any> = [];
	closed: {code: number; reason: string} | undefined;
	ws: WebSocket;
	next = 1;
	private constructor(ws: WebSocket) {
		this.ws = ws;
		ws.addEventListener("message", (e) => {
			const text = String(e.data);
			try {
				this.frames.push(JSON.parse(text));
			} catch {
				this.frames.push(text);
			}
		});
		ws.addEventListener("close", (e) => {
			this.closed = {code: e.code, reason: e.reason};
		});
	}
	static open = (url: string) =>
		new Promise<Raw>((resolve, reject) => {
			const ws = new WebSocket(url);
			const raw = new Raw(ws);
			ws.addEventListener("open", () => resolve(raw));
			ws.addEventListener("error", () => reject(new Error(`socket failed: ${url}`)));
		});
	/** A JSON-RPC call, written by hand, and its one answer. */
	call = async (method: string, params?: unknown, timeout = 5000) => {
		const id = this.next++;
		const t0 = performance.now();
		this.ws.send(
			JSON.stringify({jsonrpc: "2.0", id, method, ...(params === undefined ? {} : {params})}),
		);
		const found = await this.until((f) => f?.id === id && f?.chunk !== true, timeout);
		return {frame: found, ms: performance.now() - t0};
	};
	until = async (test: (frame: any) => boolean, timeout = 5000) => {
		const t0 = performance.now();
		while (performance.now() - t0 < timeout) {
			const found = this.frames.find(test);
			if (found !== undefined) return found;
			if (this.closed !== undefined) return undefined;
			await sleep(2);
		}
		return undefined;
	};
	close = () => this.ws.close();
}

export const wakes = async (mf: Miniflare, name: string) => {
	const r = await mf.dispatchFetch(`http://x/wakes?name=${name}`);
	return (await r.json()) as {wakes: number; sockets: number; auto: string | null};
};
