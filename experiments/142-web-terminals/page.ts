import type {Mount, Term} from "./term.ts";

// Experiment 142's page: N terminals of one library, each in a 300 by 190 tile, as the app's 16
// tiles are at 1200 by 760 (experiment 141). The page does nothing on its own between
// measurements: no timer, no animation frame of its own. The script drives it through
// `window.bench`.
//
//   page.html?lib=wterm&n=16
//   await bench.ready;          // every terminal mounted, its prompt drawn, tile 0 focused
//   await bench.burst();        // every terminal is sent 2,000 lines at once
//   bench.typing.arm();         // then the script presses keys; bench.typing.seen has the times

interface Lib {
	readonly load: () => Promise<{mount: Mount}>;
	readonly variant: string;
	/** The library's own stylesheet, copied beside the page. */
	readonly css?: string;
}
const LIBS: Record<string, Lib> = {
	blank: {load: () => import("./blank.ts"), variant: ""},
	"ghostty-web": {load: () => import("./ghostty-web.ts"), variant: ""},
	"ghostty-web-steady": {load: () => import("./ghostty-web.ts"), variant: "steady"},
	"ghostty-web-patched": {load: () => import("./ghostty-web-patched.ts"), variant: ""},
	"ghostty-web-patched-steady": {load: () => import("./ghostty-web-patched.ts"), variant: "steady"},
	wterm: {load: () => import("./wterm.ts"), variant: "", css: "wterm.css"},
	xterm: {load: () => import("./xterm.ts"), variant: "", css: "xterm.css"},
	"xterm-webgl": {load: () => import("./xterm.ts"), variant: "webgl", css: "xterm.css"},
	"xterm-sr": {load: () => import("./xterm.ts"), variant: "sr", css: "xterm.css"},
	restty: {load: () => import("./restty.ts"), variant: ""},
};

const stylesheet = (href: string) =>
	new Promise<void>((resolve) => {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = href;
		link.onload = () => resolve();
		link.onerror = () => resolve();
		document.head.append(link);
	});

const query = new URLSearchParams(location.search);
const lib = query.get("lib") ?? "";
const n = Number(query.get("n") ?? "1");
/** A tile's size: 300 by 190 for the comparison; one tile the size of the window for a check. */
const [W, H] = (query.get("tile") ?? "300x190").split("x").map(Number) as [number, number];
const COLUMNS = Math.max(1, Math.floor(innerWidth / W));
const PROMPT = "tsh$ ";

const info = {
	lib,
	n,
	drawn: "",
	/** No Node in the page: both must be "undefined". */
	node: {process: typeof globalThis.process, require: typeof globalThis.require},
	errors: [] as string[],
	csp: [] as string[],
};
addEventListener("error", (e) => {
	// Chromium's note that a ResizeObserver callback resized again: harmless, and not the library's
	// failure to load.
	if (!String(e.message).startsWith("ResizeObserver loop")) info.errors.push(String(e.message));
});
addEventListener("unhandledrejection", (e) => info.errors.push(String(e.reason)));
document.addEventListener("securitypolicyviolation", (e) =>
	info.csp.push(`${e.violatedDirective} ${e.blockedURI}`.trim()),
);

const terms: Term[] = [];
/** What each terminal sent as keys. */
const sent: string[][] = [];
/** Is a measurement listening to draws? Off while idle, so idle costs the library alone. */
let watching = false;
const onDraw: ((i: number) => void)[] = [];
/** Draws per terminal, counted always: one add per draw. Idle, it says who draws for nothing. */
const draws: number[] = [];

/** The page's keydown capture, as the app's desk has it: Ctrl-B and the key after are the desk's. */
const keys = {caught: [] as string[], armed: false};
addEventListener(
	"keydown",
	(e) => {
		const prefix = e.ctrlKey && e.key === "b";
		if (!prefix && !keys.armed) return;
		keys.armed = prefix;
		keys.caught.push(e.key);
		e.preventDefault();
		e.stopImmediatePropagation();
	},
	{capture: true},
);

const tile = (i: number) => {
	const el = document.createElement("div");
	el.className = "tile";
	el.dataset.tile = String(i);
	el.style.left = `${(i % COLUMNS) * W}px`;
	el.style.top = `${Math.floor(i / COLUMNS) * H}px`;
	el.style.width = `${W}px`;
	el.style.height = `${H}px`;
	const term = document.createElement("div");
	term.className = "term";
	const screen = document.createElement("div");
	screen.className = "screen";
	term.append(screen);
	el.append(term);
	document.body.append(el);
	return screen;
};

/** The pty's echo, one task later, as bytes come back from the main process in the app. */
const echoer = (term: Term) => {
	const {port1, port2} = new MessageChannel();
	port2.onmessage = (e) => term.write(String(e.data));
	return (data: string) => port1.postMessage(data);
};

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

const start = async () => {
	const chosen = LIBS[lib];
	if (chosen === undefined) throw new Error(`no library ${lib}`);
	if (chosen.css !== undefined) await stylesheet(chosen.css);
	const {mount} = await chosen.load();
	for (let i = 0; i < n; i += 1) {
		const term = await mount(tile(i), chosen.variant);
		const echo = echoer(term);
		sent.push([]);
		term.onData((data) => {
			sent[i]?.push(data);
			if (!data.includes("\x02")) echo(data);
		});
		draws.push(0);
		term.onDrawn(() => {
			draws[i] = (draws[i] ?? 0) + 1;
			if (watching) for (const f of onDraw) f(i);
		});
		term.write(PROMPT);
		terms.push(term);
		info.drawn = term.drawn;
	}
	terms[0]?.focus();
	for (let i = 0; i < 5; i += 1) await frame();
};

/** The last rows with text, bottom up. */
const tail = (term: Term) =>
	term
		.rows()
		.map((r) => r.trimEnd())
		.filter((r) => r !== "")
		.slice(-2);

/** A burst's lines: `seq 1 2000`, or 2,000 colored lines like a build log's. */
const LINES = {
	seq: (i: number) => [`${i}\r\n`, `${i}`],
	color: (i: number) => [
		`\x1b[32m${i}\x1b[0m \x1b[1;34mbuild\x1b[0m step \x1b[33m${i % 97}\x1b[0m \x1b[2mok\x1b[0m\r\n`,
		`${i} build step ${i % 97} ok`,
	],
} as const;

/** Every terminal gets 2,000 lines at once, in 4 KiB pieces, one piece per task, round robin. */
const burst = async (kind: keyof typeof LINES = "seq") => {
	if (terms[0]?.drawn.startsWith("none")) return null;
	const line = LINES[kind];
	const text = `${Array.from({length: 2000}, (_, i) => line(i + 1)[0]).join("")}${PROMPT}`;
	const end = line(2000)[1];
	const pieces: string[] = [];
	for (let at = 0; at < text.length; at += 4096) pieces.push(text.slice(at, at + 4096));
	const done: (number | null)[] = terms.map(() => null);
	const gaps: number[] = [];
	const t0 = performance.now();
	onDraw.length = 0;
	onDraw.push((i) => {
		const term = terms[i];
		if (done[i] !== null || term === undefined) return;
		const [before, last] = tail(term);
		if (before === end && last === PROMPT.trimEnd()) done[i] = performance.now() - t0;
	});
	watching = true;
	const {port1, port2} = new MessageChannel();
	let next = 0;
	port2.onmessage = () => {
		const term = terms[next % terms.length];
		const piece = pieces[Math.floor(next / terms.length)];
		if (term !== undefined && piece !== undefined) term.write(piece);
		next += 1;
		if (next < pieces.length * terms.length) port1.postMessage(0);
	};
	port1.postMessage(0);
	let last = t0;
	while (performance.now() - t0 < 20_000) {
		const now = await frame();
		gaps.push(now - last);
		last = now;
		if (done.every((d) => d !== null)) break;
	}
	watching = false;
	const sorted = [...gaps].sort((a, b) => a - b);
	return {
		settledMs: done.every((d) => d !== null) ? Math.max(...(done as number[])) : null,
		frames: gaps.length,
		worstGapMs: sorted.at(-1) ?? null,
		medianGapMs: sorted[Math.floor(sorted.length / 2)] ?? null,
		over50ms: gaps.filter((g) => g > 50).length,
	};
};

/**
 * Busy, not flooded: every terminal gets `perSecond` colored lines a second, 10 lines every 50 ms,
 * as a build log scrolls, until stopped. The script reads CPU meanwhile.
 */
const stream = (perSecond: number) => {
	const each = Math.max(1, Math.round(perSecond / 20));
	let sent = 0;
	const timer = setInterval(() => {
		const text = Array.from({length: each}, (_, k) => LINES.color(sent + k + 1)[0]).join("");
		sent += each;
		for (const term of terms) term.write(text);
	}, 50);
	return () => clearInterval(timer);
};
let stopStream = () => {};

/** Keydown (its timeStamp) to the draw that first shows the key, in the focused terminal 0. */
const typing = {
	seen: [] as {down: number; drawn: number | null; after: number | null}[],
	arm: () => {
		const term = terms[0];
		if (term === undefined) return;
		let typed = "";
		addEventListener(
			"keydown",
			(e) => {
				if (e.key.length !== 1 || e.ctrlKey) return;
				typed += e.key;
				typing.seen.push({down: e.timeStamp, drawn: null, after: null});
			},
			{capture: true},
		);
		onDraw.length = 0;
		onDraw.push((i) => {
			const one = typing.seen.at(-1);
			if (i !== 0 || one === undefined || one.drawn !== null) return;
			if (!term.rows().some((r) => r.includes(`${PROMPT}${typed}`))) return;
			one.drawn = performance.now();
			requestAnimationFrame((now) => {
				one.after = now;
			});
		});
		watching = true;
	},
};

Object.assign(window, {
	bench: {
		info,
		keys,
		sent,
		draws,
		/** Is the page shown and focused? A hidden or covered window gets no animation frames. */
		shown: () => ({visibility: document.visibilityState, focus: document.hasFocus()}),
		typing,
		burst,
		stream: (perSecond: number) => {
			stopStream = stream(perSecond);
		},
		stop: () => stopStream(),
		text: (i: number) => terms[i]?.rows().join("\n") ?? "",
		focus: (i: number) => terms[i]?.focus(),
		write: (i: number, data: string) => terms[i]?.write(data),
		ready: start().catch((e) => {
			info.errors.push(String(e?.stack ?? e));
		}),
	},
});
