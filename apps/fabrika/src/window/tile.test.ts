import {readFileSync} from "node:fs";
import {join} from "node:path";
import {type ComponentProps, createElement, isValidElement, type ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {defaults} from "../desk/keymap.ts";
import {
	createContainer,
	createTile,
	type LayoutNode,
	type Line,
	type TileNode,
} from "../desk/layout/index.ts";
import type {FromPage} from "../messages.ts";
import {tileWord} from "./frame.ts";
import {Strip, Tile} from "./tile.tsx";

// A tile and a strip, drawn as the desk draws them (docs/direction/tile-guidelines.md, decided
// 2026-11-01). The title bar is a mono `header`: the slot (a pipe's letter, or a dot), the program
// name, the state word, then the id at the far right. A pipe is marked by `data-pipe`, its color's
// name, and by the letter; color is never the only cue. Tile and Strip take the desk's messages
// as `toHost`, so a test draws them with no page around them.

const tracker = {id: "tracker:1", program: "tracker"};
const ticket = {id: "ticket:1", program: "ticket"};
/** The ticket program's view said it shows ticket 7. */
const TICKETS: ReadonlyMap<string, number> = new Map([["ticket:1", 7]]);

const pipe = (tint: Line["tint"], letter: string): Line => ({
	id: "tracker:1",
	from: "t1",
	tint,
	letter,
});

const A = pipe(0, "A");

/** t1 shows the tracker a pipe was typed in; t2 shows the pipe's ticket; t4 is a plain tsh. */
const t1 = createTile("t1", {kind: "line", run: tracker, line: A});
const t2 = createTile("t2", {kind: "window", run: ticket, line: A});
const t4 = createTile("t4");

type TileProps = ComponentProps<typeof Tile>;

const propsOf = (
	tile: TileNode,
	over: Partial<TileProps> = {},
	toHost: (msg: FromPage) => void = () => {},
): TileProps => ({
	tile,
	focused: false,
	asking: null,
	closing: false,
	zoomed: false,
	folds: true,
	tickets: TICKETS,
	keys: defaults,
	toHost,
	children: createElement("div", {className: "body"}),
	...over,
});

const drawn = (tile: TileNode, over: Partial<TileProps> = {}) =>
	renderToStaticMarkup(createElement(Tile, propsOf(tile, over)));

const strip = (node: LayoutNode, toHost: (msg: FromPage) => void = () => {}) =>
	renderToStaticMarkup(createElement(Strip, {node, toHost}));

/** Text with its tags gone. */
const words = (html: string) =>
	html
		.replace(/<[^>]*>/g, "")
		.replace(/\s+/g, " ")
		.trim();

/** The title bar's markup: its attributes and what it holds. */
const titlebarOf = (html: string) => {
	const m = /<header([^>]*)>([\s\S]*?)<\/header>/.exec(html);
	return {attrs: m?.[1] ?? "", inner: m?.[2] ?? ""};
};

/** The first element with this class in some markup: its attributes and its words. */
const partOf = (html: string, name: string) => {
	const m = new RegExp(
		`<(\\w+)([^>]*class="(?:[^"]* )?${name}(?: [^"]*)?"[^>]*)>([\\s\\S]*?)</\\1>`,
	).exec(html);
	return m === null ? null : {attrs: m[2] ?? "", words: words(m[3] ?? "")};
};

/** The title bar's parts that the rules name, in the order they are drawn. */
const orderOf = (html: string) =>
	[...titlebarOf(html).inner.matchAll(/class="([^"]*)"/g)]
		.flatMap(([, names = ""]) => names.split(" "))
		.filter((name) => ["slot", "name", "state", "tid"].includes(name));

const stateOf = (html: string) => partOf(titlebarOf(html).inner, "state")?.words ?? "";

describe("a tile's title bar", () => {
	it("is a header, not a button, with no tab stop", () => {
		for (const tile of [t2, t4]) {
			const html = drawn(tile, {focused: true});
			const bar = titlebarOf(html);
			expect(bar.attrs).toContain('class="titlebar"');
			expect(html).not.toContain("<button");
			expect(`${bar.attrs}${bar.inner}`).not.toContain("tabindex");
		}
	});

	it("names the program as the status bar does, so a ticket says its number", () => {
		expect(partOf(drawn(t2), "name")?.words).toBe(tileWord(t2, TICKETS));
		expect(partOf(drawn(t2), "name")?.words).toBe("ticket #7");
		expect(partOf(drawn(t4), "name")?.words).toBe("tsh");
	});

	it("draws the slot, the name, the state word, then the id last", () => {
		const html = drawn(t2, {closing: true});
		expect(orderOf(html)).toEqual(["slot", "name", "state", "tid"]);
		expect(titlebarOf(html).inner).toMatch(/<span[^>]*class="tid"[^>]*>t2<\/span>$/);
	});

	it("puts a pipe's letter in the slot and a dot for a plain tile, so the name sits in one place", () => {
		const inPipe = partOf(titlebarOf(drawn(t2)).inner, "slot");
		const plain = partOf(titlebarOf(drawn(t4)).inner, "slot");
		expect(inPipe?.words).toBe("A");
		expect(inPipe?.attrs).toContain('aria-hidden="true"');
		expect(plain).not.toBeNull();
		expect(plain?.words).not.toMatch(/[a-z0-9]/i);
		expect(plain?.attrs).toContain('aria-hidden="true"');
		// The name is second in both, so it does not move when a tile joins or leaves a pipe.
		expect(orderOf(drawn(t2)).slice(0, 2)).toEqual(["slot", "name"]);
		expect(orderOf(drawn(t4)).slice(0, 2)).toEqual(["slot", "name"]);
	});

	it("names its pipe's color on the tile, sky first, and a seventh pipe repeats a color with its own letter", () => {
		expect(drawn(t2)).toMatch(/<section[^>]*data-pipe="sky"/);
		const pink = createTile("t5", {kind: "window", run: ticket, line: pipe(1, "B")});
		expect(drawn(pink)).toMatch(/<section[^>]*data-pipe="pink"/);
		const seventh = createTile("t9", {kind: "window", run: ticket, line: pipe(0, "G")});
		expect(drawn(seventh)).toMatch(/<section[^>]*data-pipe="sky"/);
		expect(partOf(titlebarOf(drawn(seventh)).inner, "slot")?.words).toBe("G");
		expect(drawn(t4)).not.toContain("data-pipe");
		// The old tint is gone: the page names a color, it mixes none.
		expect(drawn(t2)).not.toContain("data-tint");
	});

	it("says closing, zoomed or the close question in the state slot, and no box covers the id", () => {
		const closing = drawn(t2, {closing: true});
		expect(stateOf(closing)).toBe("closing");
		expect(closing).toMatch(/<section[^>]*class="[^"]*\bclosing\b/);
		expect(closing).not.toContain("closing-note");
		expect(stateOf(drawn(t2, {zoomed: true}))).toBe("zoomed");
		expect(stateOf(drawn(t2, {asking: "close t2? (y/n)"}))).toBe("close t2? (y/n)");
		// The question is what waits on the person, so it wins the one slot.
		expect(stateOf(drawn(t2, {asking: "stop t2 now? (y/n)", closing: true, zoomed: true}))).toBe(
			"stop t2 now? (y/n)",
		);
		expect(stateOf(drawn(t2, {closing: true, zoomed: true}))).toBe("closing");
		expect(stateOf(drawn(t2))).toBe("");

		for (const html of [
			closing,
			drawn(t2, {zoomed: true}),
			drawn(t2, {asking: "close t2? (y/n)"}),
		]) {
			expect(orderOf(html).at(-1)).toBe("tid");
		}
	});

	it("marks only the close question as asking, never closing or zoomed", () => {
		const classOf = (html: string) =>
			/class="([^"]*)"/.exec(partOf(titlebarOf(html).inner, "state")?.attrs ?? "")?.[1];
		expect(classOf(drawn(t2, {asking: "close t2? (y/n)"}))).toBe("state asking");
		expect(classOf(drawn(t2, {closing: true}))).toBe("state");
		expect(classOf(drawn(t2, {zoomed: true}))).toBe("state");
	});
});

describe("a tile's section", () => {
	const sectionOf = (html: string, attr: string) =>
		new RegExp(`<section[^>]*\\s${attr}="([^"]*)"`).exec(html)?.[1];

	it("is a tile, then focused and closing only when it is", () => {
		expect(sectionOf(drawn(t2), "class")).toBe("tile");
		expect(sectionOf(drawn(t2, {focused: true}), "class")).toBe("tile focused");
		expect(sectionOf(drawn(t2, {closing: true}), "class")).toBe("tile closing");
		expect(sectionOf(drawn(t2, {focused: true, closing: true}), "class")).toBe(
			"tile focused closing",
		);
	});

	it("tells a screen reader its id, its program, the line it is a window of, and closing", () => {
		expect(sectionOf(drawn(t4), "aria-label")).toBe("tile t4");
		const run = createTile("t6", {kind: "tsh", run: tracker});
		expect(sectionOf(drawn(run), "aria-label")).toBe("tile t6, tracker");
		expect(sectionOf(drawn(t2), "aria-label")).toBe(
			"tile t2, ticket, a window of the line typed in t1",
		);
		expect(sectionOf(drawn(t2, {closing: true}), "aria-label")).toBe(
			"tile t2, ticket, a window of the line typed in t1, closing",
		);
	});
});

/** The handlers a tile gives its section and its title bar, read inside a render so hooks run. */
const handlersOf = (props: TileProps) => {
	const found: {section?: Record<string, unknown>; header?: Record<string, unknown>} = {};
	const walk = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const kid of node) {
				walk(kid);
			}

			return;
		}

		if (!isValidElement(node)) {
			return;
		}

		const given = node.props;

		if (typeof given !== "object" || given === null) {
			return;
		}

		if (node.type === "section") {
			found.section = {...given};
		}

		if (node.type === "header") {
			found.header = {...given};
		}

		if ("children" in given) {
			walk(given.children);
		}
	};
	function Read(): ReactNode {
		const tile = Tile(props);
		walk(tile);
		return tile;
	}
	renderToStaticMarkup(createElement(Read));
	return found;
};

/** Call a handler the way React would, with an event that only counts its preventDefault. */
const fire = (handler: unknown) => {
	let prevented = false;

	if (typeof handler === "function") {
		handler({
			preventDefault: () => {
				prevented = true;
			},
		});
	}

	return {called: typeof handler === "function", prevented};
};

describe("a press on a tile", () => {
	it("folds on a double-click on the title bar, and the last open tile does not fold", () => {
		const sent: FromPage[] = [];
		const {header} = handlersOf(propsOf(t2, {}, (m) => sent.push(m)));
		expect(fire(header?.onDoubleClick).called).toBe(true);
		expect(sent).toEqual([{type: "fold", tile: "t2"}]);
		const last: FromPage[] = [];
		fire(handlersOf(propsOf(t2, {folds: false}, (m) => last.push(m))).header?.onDoubleClick);
		expect(last).toEqual([]);
	});

	it("focuses the tile from anywhere on it, and a press on the title bar takes no focus of its own", () => {
		const sent: FromPage[] = [];
		const {section, header} = handlersOf(propsOf(t2, {}, (m) => sent.push(m)));
		fire(section?.onPointerDownCapture);
		expect(sent).toEqual([{type: "click", tile: "t2"}]);
		expect(fire(header?.onPointerDown).prevented).toBe(true);
	});
});

describe("a strip", () => {
	const folded = (tile: TileNode): TileNode => ({...tile, folded: true});

	it("takes its tile's pipe color and letter, and a plain one a dot", () => {
		const inPipe = strip(folded(t2));
		expect(inPipe).toMatch(/<button[^>]*data-pipe="sky"/);
		expect(partOf(inPipe, "slot")?.words).toBe("A");
		expect(partOf(inPipe, "slot")?.attrs).toContain('aria-hidden="true"');
		const plain = strip(folded(t4));
		expect(plain).not.toContain("data-pipe");
		expect(partOf(plain, "slot")?.words).not.toMatch(/[a-z0-9]/i);
		expect(inPipe).not.toContain("data-tint");
	});

	it("for a folded column, takes a pipe's color only when all its tiles are in that one pipe", () => {
		const one = createContainer("c2", "vertical", [folded(t1), folded(t2)]);
		expect(strip(one)).toMatch(/<button[^>]*data-pipe="sky"/);
		expect(partOf(strip(one), "slot")?.words).toBe("A");
		const mixed = createContainer("c3", "vertical", [folded(t2), folded(t4)]);
		expect(strip(mixed)).not.toContain("data-pipe");
	});

	it("is named by its programs in order, tsh for a plain tile, and says so to a screen reader", () => {
		const labelOf = (html: string) => /<button[^>]*\saria-label="([^"]*)"/.exec(html)?.[1];
		expect(partOf(strip(folded(t2)), "strip-name")?.words).toBe("ticket");
		expect(labelOf(strip(folded(t2)))).toBe("open ticket, t2");
		expect(partOf(strip(folded(t4)), "strip-name")?.words).toBe("tsh");
		const column = createContainer("c3", "vertical", [folded(t1), folded(t2), folded(t4)]);
		expect(partOf(strip(column), "strip-name")?.words).toBe("tracker · ticket · tsh");
		expect(labelOf(strip(column))).toBe("open tracker · ticket · tsh, c3");
	});

	it("opens what it stands for on a click", () => {
		const sent: FromPage[] = [];
		const html = renderToStaticMarkup(createElement(Strip, {node: folded(t2), toHost: () => {}}));
		expect(html).toContain('data-strip="t2"');
		const element = Strip({node: folded(t2), toHost: (m) => sent.push(m)});
		const onClick = isValidElement(element) ? Reflect.get(Object(element.props), "onClick") : null;
		fire(onClick);
		expect(sent).toEqual([{type: "unfold", node: "t2"}]);
	});
});

// ---- the stylesheet ----------------------------------------------------------------------------
// Read, not drawn, as scroll.test.ts and themes.test.ts read it. A rule "draws" a part when the
// last compound of one of its selectors names that part's class.

const CSS = readFileSync(join(import.meta.dirname, "window.css"), "utf8").replace(
	/\/\*[\s\S]*?\*\//g,
	"",
);

/** The body of every @media block whose query matches. */
const insideMedia = (css: string, query: RegExp) => {
	const bodies: string[] = [];

	for (const m of css.matchAll(/@media([^{]*)\{/g)) {
		if (!query.test(m[1] ?? "")) {
			continue;
		}

		let depth = 1;
		const from = (m.index ?? 0) + m[0].length;
		let i = from;

		while (i < css.length && depth > 0) {
			if (css[i] === "{") {
				depth += 1;
			}

			if (css[i] === "}") {
				depth -= 1;
			}

			i += 1;
		}

		bodies.push(css.slice(from, i - 1));
	}

	return bodies.join("\n");
};

/** The stylesheet with every @media block taken out: what draws with no setting on. */
const outsideMedia = (css: string) => {
	let out = "";
	let at = 0;

	for (const m of css.matchAll(/@media[^{]*\{/g)) {
		if ((m.index ?? 0) < at) {
			continue;
		}

		out += css.slice(at, m.index);
		let depth = 1;
		let i = (m.index ?? 0) + m[0].length;

		while (i < css.length && depth > 0) {
			if (css[i] === "{") {
				depth += 1;
			}

			if (css[i] === "}") {
				depth -= 1;
			}

			i += 1;
		}

		at = i;
	}

	return out + css.slice(at);
};

/** Each innermost rule: its selectors, split at commas, and its declarations. */
const rulesOf = (css: string) =>
	[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
		selectors: selector
			.split(",")
			.map((s) => s.trim().replace(/\s+/g, " "))
			.filter((s) => !s.startsWith("@")),
		says: new Map(
			body
				.split(";")
				.map((d) => {
					const at = d.indexOf(":");
					return [
						d.slice(0, at).trim(),
						d
							.slice(at + 1)
							.trim()
							.replace(/\s+/g, " "),
					] as const;
				})
				.filter(([name]) => name !== ""),
		),
	}));

/** The last compound of a selector: `.tile.focused .titlebar` gives `.titlebar`. */
const lastOf = (selector: string) => selector.split(/\s*[\s>+~]\s*/).at(-1) ?? "";

/** Does the rule draw a part with this class itself, not something inside it. */
const draws = (selector: string, part: string) =>
	new RegExp(`\\.${part}(?![\\w-])`).test(lastOf(selector));

/** One selector's declarations, merged in the stylesheet's order, as the cascade would. */
const styleOf = (rules: ReturnType<typeof rulesOf>, selector: string) =>
	new Map(rules.filter((r) => r.selectors.includes(selector)).flatMap((r) => [...r.says]));

const BASE = rulesOf(outsideMedia(CSS));
const ALL = rulesOf(CSS);

/** What a title bar's part sits in, for a color it does not set itself. */
const PARENT: Readonly<Record<string, string>> = {
	slot: "titlebar",
	name: "titlebar",
	state: "titlebar",
	tid: "titlebar",
	titlebar: "tile",
};

/**
 * The color a part is drawn in, outside any setting, when the tile and the part have these classes
 * and nothing is hovered or in a pipe: the most specific rule that names only those classes, last
 * wins a tie, else what the part sits in. A sketch of the cascade, enough for these few rules.
 */
const colorIn = (classes: readonly string[], part: string): string | undefined => {
	const applies = (selector: string) =>
		!/[[:]/.test(selector) &&
		draws(selector, part) &&
		(selector.match(/\.[\w-]+/g) ?? []).every((c) => classes.includes(c.slice(1)));
	const found = BASE.flatMap((r, at) =>
		r.says.has("color")
			? r.selectors
					.filter(applies)
					.map((s) => ({at, weight: s.split(".").length - 1, color: r.says.get("color")}))
			: [],
	).sort((a, b) => a.weight - b.weight || a.at - b.at);
	const parent = PARENT[part];
	return found.at(-1)?.color ?? (parent === undefined ? undefined : colorIn(classes, parent));
};

/** The frame's tile parts: a tile, its title bar, a strip, and the divider between two tiles. */
const PARTS = ["tile", "titlebar", "strip", "border", "divider"];

describe("a tile's edge in the stylesheet", () => {
	it("is drawn by no box-shadow, on a tile, a strip, a title bar or a divider", () => {
		const shadows = ALL.flatMap((r) =>
			r.selectors
				.filter((s) => PARTS.some((part) => draws(s, part)))
				.filter(() => r.says.has("box-shadow"))
				.map((s) => `${s} { box-shadow: ${r.says.get("box-shadow")} }`),
		);
		expect(shadows).toEqual([]);
	});

	it("draws no line under the title bar", () => {
		const lines = ALL.flatMap((r) =>
			r.selectors
				.filter((s) => draws(s, "titlebar"))
				.flatMap((s) =>
					[...r.says]
						.filter(([name, value]) =>
							name === "border-bottom" || name === "border-block-end"
								? true
								: name === "border" && !/^(0|none)$/.test(value),
						)
						.map(([name, value]) => `${s} { ${name}: ${value} }`),
				),
		);
		expect(lines).toEqual([]);
	});

	it("is one 1px outline on a tile and a strip, lit when focused, dashed when closing", () => {
		const edge = "1px solid var(--tile-edge)";
		expect(styleOf(BASE, ".tile").get("outline")).toBe(edge);
		expect(styleOf(BASE, ".strip").get("outline")).toBe(edge);
		expect(styleOf(BASE, ".tile.focused").get("outline-color")).toBe("var(--tile-edge-on)");
		// A closing tile keeps its step and its color: the dash and the word say it.
		const closing = styleOf(BASE, ".tile.closing");
		expect(closing.get("outline-style")).toBe("dashed");
		expect(closing.has("outline-color") || closing.has("outline")).toBe(false);
	});

	it("gives a strip a hover in its color and a 2px ring that is not its hover", () => {
		expect(styleOf(BASE, ".strip:hover").get("outline-color")).toBe("var(--tile-edge-hover)");
		const ring = styleOf(BASE, ".strip:focus-visible");
		expect(ring.get("outline")).toBe("2px solid var(--tile-edge-on)");
		expect(ring.get("outline")).not.toContain("none");
		// One rule for both was why a pipe's strip never showed its ring (tile guidelines, the fold).
		const both = BASE.filter(
			(r) => r.selectors.includes(".strip:hover") && r.selectors.includes(".strip:focus-visible"),
		);
		expect(both).toEqual([]);
	});

	it("washes the title bar and a strip, brighter when the tile is focused", () => {
		expect(styleOf(BASE, ".titlebar").get("background")).toBe("var(--tile-wash)");
		expect(styleOf(BASE, ".strip").get("background")).toBe("var(--tile-wash)");
		expect(styleOf(BASE, ".tile.focused .titlebar").get("background")).toBe("var(--tile-wash-on)");
	});

	// Weight 500 is the one focus cue on a view tile that is not a color: a view has no cursor
	// (tile guidelines, the focus; WCAG 1.4.1).
	it("sets a focused tile's name at step 12 and weight 500, and the close question at step 12", () => {
		const name = styleOf(BASE, ".tile.focused .name");
		expect(name.get("font-weight")).toBe("500");
		expect(name.get("color")).toBe("var(--tile-text-on)");
		expect(styleOf(BASE, ".titlebar .name").get("font-weight")).toBeUndefined();
		expect(colorIn(["tile", "titlebar", "name"], "name")).toBe("var(--tile-text)");
		expect(colorIn(["tile", "focused", "titlebar", "name"], "name")).toBe("var(--tile-text-on)");
		expect(styleOf(BASE, ".titlebar .state.asking").get("color")).toBe("var(--tile-text-on)");
		expect(colorIn(["tile", "titlebar", "state", "asking"], "state")).toBe("var(--tile-text-on)");
	});

	// FAILING ON PURPOSE (test writer, round 2b), for the builder to fix in window.css. On a focused
	// tile only the name rises to step 12: the dot and the `closing` or `zoomed` word stay at the
	// quiet step (tile guidelines: the pipe mark's tokens, and the closing tile's). Today
	// `.tile.focused .titlebar` sets `--tile-text-on` on the whole bar, so both inherit it.
	it("keeps a focused plain tile's dot and its closing or zoomed word at the quiet step", () => {
		expect(colorIn(["tile", "titlebar", "slot"], "slot")).toBe("var(--tile-text)");
		expect(colorIn(["tile", "titlebar", "state"], "state")).toBe("var(--tile-text)");
		expect(colorIn(["tile", "focused", "titlebar", "slot"], "slot")).toBe("var(--tile-text)");
		expect(colorIn(["tile", "focused", "titlebar", "state"], "state")).toBe("var(--tile-text)");
	});

	it("lights a divider on hover at slate a7", () => {
		const hover = [
			...styleOf(BASE, ".border:hover").values(),
			...styleOf(BASE, ".divider:hover").values(),
		];
		expect(hover.some((v) => v === "var(--border-strong)" || v === "var(--tile-edge-hover)")).toBe(
			true,
		);
	});
});

describe("the old tint", () => {
	it("is gone: no --line-N, no [data-tint], no oklch in a tile's rule", () => {
		expect(CSS.match(/--line-(\d|strength)/g) ?? []).toEqual([]);
		expect(CSS.match(/\[data-tint/g) ?? []).toEqual([]);
		const oklch = ALL.flatMap((r) =>
			r.selectors
				.filter((s) => PARTS.some((part) => draws(s, part)) || s.includes("[data-pipe"))
				.filter(() => [...r.says.values()].some((v) => v.includes("oklch("))),
		);
		expect(oklch).toEqual([]);
	});
});

describe("a tile under a person's own settings", () => {
	const FORCED = rulesOf(insideMedia(CSS, /forced-colors:\s*active/));
	const MORE = rulesOf(insideMedia(CSS, /prefers-contrast:\s*more/));
	const outlineOf = (rules: ReturnType<typeof rulesOf>, selector: string) => {
		const style = styleOf(rules, selector);
		return [style.get("outline"), style.get("outline-width"), style.get("outline-color")]
			.filter((v) => v !== undefined)
			.join(" ");
	};

	// Forced colors drop box-shadow and backgrounds: the edges are system colors, the letter and the
	// dot stay, and focus is a 2px Highlight.
	it("in forced colors, draws CanvasText edges, a 2px Highlight focus, and a CanvasText slot", () => {
		expect(FORCED.length).toBeGreaterThan(0);
		expect(outlineOf(FORCED, ".tile")).toContain("CanvasText");
		expect(outlineOf(FORCED, ".strip")).toContain("CanvasText");

		for (const focused of [".tile.focused", ".strip:focus-visible"]) {
			expect(outlineOf(FORCED, focused)).toContain("2px");
			expect(outlineOf(FORCED, focused)).toContain("Highlight");
		}

		const slot = FORCED.filter((r) => r.selectors.some((s) => draws(s, "slot")));
		expect(slot.map((r) => r.says.get("color"))).toContain("CanvasText");
	});

	// More contrast is ours to set for the tile, never the theme's: theme repair is the themes plan's.
	it("under more contrast, sets only tile tokens, the resting edge and the text among them", () => {
		expect(MORE.length).toBeGreaterThan(0);
		const set = MORE.flatMap((r) => [...r.says.keys()].filter((name) => name.startsWith("--")));
		expect(set.filter((name) => !name.startsWith("--tile-"))).toEqual([]);
		expect(set).toContain("--tile-edge");
		expect(set).toContain("--tile-text");
		const raw = MORE.flatMap((r) =>
			[...r.says]
				.filter(([name]) => !name.startsWith("--"))
				.filter(([, value]) => /#[0-9a-f]{3,8}\b/i.test(value) || /var\(--(?!tile-)/.test(value))
				.map(([name, value]) => `${name}: ${value}`),
		);
		expect(raw).toEqual([]);
	});
});

describe("a tile with the bars hidden", () => {
	it("still draws its slot, name, state word and id: no rule under .bare hides them", () => {
		const hidden = ALL.flatMap((r) =>
			r.selectors
				.filter((s) => s.includes(".bare"))
				.filter((s) =>
					["titlebar", "slot", "name", "state", "tid", "strip"].some((p) => draws(s, p)),
				)
				.filter(
					() =>
						r.says.get("display") === "none" ||
						r.says.get("visibility") === "hidden" ||
						r.says.get("opacity") === "0",
				),
		);
		expect(hidden).toEqual([]);
	});
});

// An agent's tile (tracker 185b, PR 3), drawn in today's version. The desk's `agents` (name to
// tile) goes to the page, and both the title bar and the strip name the tile by its agent as text:
// `claude · tsh`. Color is never the only cue (WCAG 1.4.1), and a screen reader hears the name.
//
//   agents {claude: "t4"}    t4's title bar: "· claude · tsh ... t4"; its strip: "claude · tsh"
//   agents {claude: "t9"}    t4 is the person's, as before: "tsh"

describe("an agent's tile and strip", () => {
	// made up: the `agents` prop, the desk's `agents` as the page is sent it.
	const CLAUDE_T4 = {claude: "t4"} as const;
	const folded = (tile: TileNode): TileNode => ({...tile, folded: true});
	const labelOf = (html: string, tag: string) =>
		new RegExp(`<${tag}[^>]*aria-label="([^"]*)"`).exec(html)?.[1] ?? null;

	it("names the agent in the title bar and in what a screen reader hears, and leaves a person's tile as it was", () => {
		const html = drawn(t4, {agents: CLAUDE_T4});
		expect(partOf(html, "name")?.words).toBe("claude · tsh");
		expect(labelOf(html, "section")).toContain("claude");
		const theirs = drawn(t4, {agents: {claude: "t9"}});
		expect(partOf(theirs, "name")?.words).toBe("tsh");
		expect(labelOf(theirs, "section")).toBe("tile t4");
	});

	it("names the agent on its strip, in text and in the strip's label", () => {
		const html = renderToStaticMarkup(
			createElement(Strip, {node: folded(t4), toHost: () => {}, agents: CLAUDE_T4}),
		);
		expect(partOf(html, "strip-name")?.words).toBe("claude · tsh");
		expect(labelOf(html, "button")).toBe("open claude · tsh, t4");
		const theirs = renderToStaticMarkup(
			createElement(Strip, {node: folded(t4), toHost: () => {}, agents: {}}),
		);
		expect(partOf(theirs, "strip-name")?.words).toBe("tsh");
	});
});
