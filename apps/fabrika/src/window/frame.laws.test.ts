import {applyCell} from "@demlik/tea";
import {foldEvents} from "@demlik/tea/pbt";
import * as fc from "fast-check";
import {createElement, isValidElement, type ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, expectTypeOf, it, vi} from "vitest";
import type {AsksNow} from "../asks.ts";
import {type Desk, type DeskCmd, type DeskMsg, deskMachine, type Open} from "../desk/desk.ts";
import {holdMachine, type HoldMsg, type Key} from "../desk/hold.ts";
import {defaults} from "../desk/keymap.ts";
import type {FromPage, ToPage} from "../messages.ts";
import {
	bottomLineShows,
	FRAME,
	type Frame,
	type FrameMsg,
	frameUpdate,
	keyGoesTo,
	type MidKey,
} from "./frame.ts";
import {BottomArea, BottomLine, type FrameProps, Over, TopBar} from "./frame.tsx";
import type {PaletteProps} from "./pop.tsx";

const palette = vi.hoisted(() => ({props: null as PaletteProps | null}));
vi.mock("./pop.tsx", async (original) => {
	const real = await original<typeof import("./pop.tsx")>();
	return {
		...real,
		Palette: (props: PaletteProps) => {
			palette.props = props;
			return createElement(real.Palette, props);
		},
	};
});
// Only the browser and terminal engine are replaced. desk.tsx boots its real listener,
// reads real host messages, steps holdMachine and calls its own pressAgain handoff.
vi.mock("./terminal.ts", async () => {
	const {Effect} = await import("effect");
	return {loadGhostty: Effect.succeed(null), terminalFor: vi.fn()};
});
vi.mock("./windows.tsx", () => ({WINDOWS: new Map()}));

// Today's app, T204 PR 1. These generators cover every Over case, including the keys editor.
// Frame is a plain reducer, so fast-check drives it directly. Hold is a tea machine and uses pbt.
type Overlay = Parameters<typeof keyGoesTo>[0];
const options = {seed: 119120, numRuns: 100};
const overlay: fc.Arbitrary<Overlay> = fc.oneof(
	fc.constant({kind: "none"} as const),
	fc.constant({kind: "asks"} as const),
	fc.constant({kind: "jobs"} as const),
	fc.record({
		kind: fc.constant("item" as const),
		what: fc.constantFrom("agents" as const, "sync" as const, "host" as const),
	}),
	fc.record({
		kind: fc.constant("palette" as const),
		title: fc.constantFrom("commands" as const, "keys" as const),
		query: fc.string(),
		at: fc.nat({max: 50}),
	}),
);
const mid = fc.record({armed: fc.boolean(), asking: fc.boolean()});
const prefix = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz").map((letter) => `<c-${letter}>`);
const ordinary = fc.constantFrom(
	"j",
	"k",
	"x",
	"y",
	"n",
	" ",
	"<enter>",
	"<arrowdown>",
	"<arrowup>",
);
const owner = (over: Overlay, key: string, pref: string, state: MidKey) => {
	if (key === pref || state.armed) return "desk";
	if (over.kind === "palette") return "over";
	return state.asking || over.kind === "none" ? "desk" : "over";
};
const overlayWord = (over: Overlay) => {
	switch (over.kind) {
		case "none":
			return null;
		case "asks":
			return "ASKS";
		case "jobs":
			return "JOBS";
		case "item":
			return over.what.toUpperCase();
		case "palette":
			return over.title === "keys" ? "KEYS" : "PALETTE";
	}
};
const text = (html: string) =>
	html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

describe("today's layers: generated key ownership and Escape", () => {
	it("a single Over value chooses exactly one desk-wide overlay", () => {
		expectTypeOf<Frame["over"]>().toEqualTypeOf<Overlay>();
		expectTypeOf<Extract<Overlay, {kind: "asks"}>>().toEqualTypeOf<{readonly kind: "asks"}>();
		expectTypeOf<Extract<Overlay, {kind: "jobs"}>>().toEqualTypeOf<{readonly kind: "jobs"}>();
		// @ts-expect-error One tagged choice cannot also carry an independent open flag.
		const invalid: Overlay = {kind: "asks", paletteOpen: true};
		void invalid;
	});
	it("routes prefixes, pending prefixes and ordinary keys beneath every overlay", () => {
		fc.assert(
			fc.property(fc.tuple(overlay, prefix, mid, ordinary), ([over, pref, state, key]) => {
				expect(keyGoesTo(over, pref, pref, state)).toBe("desk");
				expect(keyGoesTo(over, key, pref, state)).toBe(owner(over, key, pref, state));
			}),
			options,
		);
	});
	it("hidden bars reveal the overlay word and its exit", () => {
		fc.assert(
			fc.property(
				fc.record({over: overlay, bare: fc.boolean(), mid}),
				({over, bare, mid: state}) => {
					const frame = {...FRAME, over, bare};
					const visible = !bare || over.kind !== "none" || state.armed || state.asking;
					expect(bottomLineShows(frame, state)).toBe(visible);
					const html = renderToStaticMarkup(
						createElement(BottomArea, {...props({frame, armed: state.armed}), instead: false}),
					);
					// The renderer must agree with the predicate when the desk has no pending question.
					expect(html.includes('<footer class="bottomline">')).toBe(
						!bare || over.kind !== "none" || state.armed,
					);
				},
			),
			options,
		);
	});
	it("status names the ordinary-key owner across overlays, prefix, question, info and bar states", () => {
		fc.assert(
			fc.property(
				fc.record({over: overlay, state: mid, bare: fc.boolean(), info: fc.boolean()}),
				({over, state, bare, info}) => {
					const desk = state.asking
						? fold({type: "key", key: defaults.prefix, at: 0}, {type: "key", key: "x", at: 1})
						: fold();
					const frame: Frame = {
						...FRAME,
						over,
						bare,
						info: info ? {kind: "on", explained: "Made-up explanation"} : {kind: "never"},
					};
					const words = text(
						renderToStaticMarkup(
							createElement(BottomLine, props({desk, frame, armed: state.armed})),
						),
					);
					const takes = owner(over, "j", defaults.prefix, state);
					const word = state.armed
						? "PREFIX"
						: takes === "over"
							? overlayWord(over)
							: state.asking
								? "close t1?"
								: info
									? "INFO"
									: "t1 tsh";
					expect(words).toContain(word);
					const owns = takes === "over" && !state.armed;
					expect(owns ? words : "takes the keys esc closes it").toMatch(
						/takes (?:the )?keys.*esc closes it/i,
					);
					expect(owns ? words.includes("t1 tsh") : false).toBe(false);
					expect(owns ? words.includes("y closes") : false).toBe(false);
				},
			),
			options,
		);
	});
	it("Escape changes only the top applicable state after generated frame messages", () => {
		const message: fc.Arbitrary<FrameMsg> = fc.oneof(
			fc.constant({type: "palette"} as const),
			fc.record({
				type: fc.constant("show" as const),
				what: fc.constantFrom("asks" as const, "jobs" as const, "bars" as const, "keys" as const),
			}),
			fc.record({type: fc.constant("info" as const), focus: fc.option(fc.string(), {nil: null})}),
			fc.record({type: fc.constant("escape" as const), desk: mid}),
		);
		fc.assert(
			fc.property(
				fc.array(fc.record({message, state: mid}), {minLength: 1, maxLength: 60}),
				(moves) => {
					let frame = FRAME;
					for (const {message, state} of moves) {
						frame = frameUpdate(frame, message);
						const next = frameUpdate(frame, {type: "escape", desk: state});
						const expected =
							frame.over.kind !== "none"
								? {...frame, over: {kind: "none"}}
								: state.armed || state.asking || frame.info.kind !== "on"
									? frame
									: {...frame, info: {kind: "off"}};
						expect(next).toEqual(expected);
						frame = next;
					}
				},
			),
			options,
		);
	});
	it("the Escape law rejects closing the overlay and info mode together", () => {
		fc.assert(
			fc.property(fc.string(), mid, (explanation, state) => {
				const frame = frameUpdate(frameUpdate(FRAME, {type: "info", focus: explanation}), {
					type: "palette",
				});
				const next = frameUpdate(frame, {type: "escape", desk: state});
				const check = (answer: Frame) => {
					expect(answer.over).toEqual({kind: "none"});
					expect(answer.info).toEqual(frame.info);
				};
				check(next);
				expect(() => check({...next, info: {kind: "off"}})).toThrow();
			}),
			options,
		);
	});
	it("held keys and immediate keys use the same current owner after host answers and overlay changes", () => {
		const key = (name: string): Key => ({
			name,
			press: {key: name, code: "KeyJ", ctrl: false, alt: false, meta: false, shift: false},
		});
		const action = fc.oneof(
			ordinary.map((name) => ({kind: "press" as const, name})),
			fc.record({kind: fc.constant("overlay" as const), over: overlay}),
			fc.record({kind: fc.constant("answer" as const), took: fc.boolean(), armed: fc.boolean()}),
		);
		fc.assert(
			fc.property(prefix, fc.array(action, {minLength: 1, maxLength: 50}), (pref, moves) => {
				let over: Overlay = {kind: "none"};
				const messages: HoldMsg[] = [
					{type: "takes", takes: {all: false, keys: [pref]}},
					{type: "key", key: key(pref)},
				];
				for (const move of moves) {
					if (move.kind === "overlay") {
						over = move.over;
						continue;
					}
					if (move.kind === "press") messages.push({type: "key", key: key(move.name)});
					else {
						const before = foldEvents(holdMachine, undefined, null, messages).finalState;
						messages.push({type: "takes", takes: {all: move.armed, keys: [pref]}});
						messages.push({type: "answer", id: before.waiting?.id ?? -1, took: move.took});
					}
					const folded = foldEvents(holdMachine, undefined, null, messages);
					const last = folded.steps.at(-1)!;
					for (const command of last.cmds) {
						if (command.type !== "pass") continue;
						const state = {
							armed: folded.finalState.takes.all || folded.finalState.waiting !== null,
							asking: false,
						};
						expect(keyGoesTo(over, command.key.name, pref, state)).toBe(
							owner(over, command.key.name, pref, state),
						);
					}
				}
			}),
			options,
		);
	});
	// Plant: remove pressAgain's keyForOver guard in desk.tsx. A held letter then reaches
	// this terminal listener while an overlay owns it, even though frame.ts routes it correctly.
	it("held letters go through the real page replay handoff before any terminal receives them", async () => {
		const page = replayPage();
		try {
			await import("./desk.tsx");
			expect(page.ready()).toBe(true);
			fc.assert(
				fc.property(
					prefix,
					fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), {minLength: 1, maxLength: 12}),
					fc.array(fc.constantFrom("asks", "jobs", "palette", "agents", "sync", "host", "keys"), {
						minLength: 1,
						maxLength: 12,
					}),
					fc.boolean(),
					(pref, letters, changes, took) => {
						// Each generated flow checks a stale terminal focus, focus already in the menu,
						// and the positive case: closing the menu really releases text to the terminal.
						for (const focus of ["terminal", "overlay", "closed"] as const) {
							page.send({type: "link", now: {kind: "stopped", why: "test reset"}});
							page.send({type: "navigation"});
							page.send({type: "keys", ...defaults, prefix: pref});
							const desk = fold();
							page.send({type: "desk", desk, takes: {all: false, keys: [pref]}});
							page.clear();
							page.terminal.focus();
							page.press(pref[3]!, true);
							const pending = page.sent.find((m) => m.type === "press");
							if (pending?.type !== "press") throw new Error("prefix never reached the host");
							for (const letter of letters) page.press(letter);
							expect(page.typed).toEqual([]);
							for (const what of changes) page.send({type: "show", what});
							// Avoid a final toggle closing the generated overlay.
							page.send({type: "navigation"});
							page.send({type: "show", what: changes.at(-1)!});
							if (focus === "closed") page.send({type: "navigation"});
							page.cover(focus !== "closed");
							if (focus === "overlay") page.input.focus();
							else page.terminal.focus();
							page.send({type: "desk", desk, takes: {all: false, keys: [pref]}});
							page.send({type: "answer", id: pending.id, took});
							expect(page.typed).toEqual(focus === "closed" ? letters : []);
							expect(page.inserted).toEqual(
								focus === "closed" ? [] : focus === "terminal" ? letters.slice(1) : letters,
							);
							page.terminal.focus();
							page.press(letters[0]!);
							expect(page.typed).toEqual(focus === "closed" ? [...letters, letters[0]] : []);
						}
					},
				),
				options,
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

// A small DOM boundary: capture runs before the terminal's listener, and only an uncanceled
// key reaches it. No frame routing, hold logic or replay decision is reimplemented here.
const replayPage = () => {
	let capture: ((event: PageKey) => void) | undefined;
	let hear: ((raw: unknown) => void) | undefined;
	let covered = false;
	const sent: FromPage[] = [];
	const typed: string[] = [];
	const inserted: string[] = [];
	class PageKey extends Event {
		from: EventTarget | null = null;
		readonly key: string;
		readonly code: string;
		readonly ctrlKey: boolean;
		readonly altKey: boolean;
		readonly metaKey: boolean;
		readonly shiftKey: boolean;
		readonly isComposing = false;
		constructor(type: string, init: KeyboardEventInit) {
			super(type, init);
			this.key = init.key ?? "";
			this.code = init.code ?? "";
			this.ctrlKey = init.ctrlKey ?? false;
			this.altKey = init.altKey ?? false;
			this.metaKey = init.metaKey ?? false;
			this.shiftKey = init.shiftKey ?? false;
		}
		override get target() {
			return this.from;
		}
		getModifierState() {
			return false;
		}
	}
	class PageElement extends EventTarget {
		isContentEditable = false;
		closest() {
			return null;
		}
		contains(target: unknown) {
			return target === this || (this === box && target === input);
		}
		querySelector() {
			return this === box ? input : null;
		}
		focus() {
			page.activeElement = this;
		}
		override dispatchEvent(event: Event) {
			if (event instanceof PageKey) {
				event.from = this;
				capture?.(event);
			}
			return event.defaultPrevented ? false : super.dispatchEvent(event);
		}
	}
	class PageInput extends PageElement {}
	const terminal = new PageElement();
	const box = new PageElement();
	const input = new PageInput();
	const page = {
		activeElement: terminal,
		body: new PageElement(),
		querySelector: () => (covered ? box : null),
		getElementById: () => null,
		execCommand: (_command: string, _ui: boolean, value: string) => inserted.push(value),
	};
	terminal.addEventListener("keydown", (event) => {
		if (event instanceof PageKey && !event.ctrlKey) typed.push(event.key);
	});
	vi.stubGlobal("Element", PageElement);
	vi.stubGlobal("HTMLElement", PageElement);
	vi.stubGlobal("HTMLInputElement", PageInput);
	vi.stubGlobal("HTMLTextAreaElement", class extends PageElement {});
	vi.stubGlobal("KeyboardEvent", PageKey);
	vi.stubGlobal("ResizeObserver", class {});
	vi.stubGlobal("navigator", {userAgent: "Linux"});
	vi.stubGlobal("document", page);
	vi.stubGlobal("window", {
		addEventListener: (name: string, listener: (event: PageKey) => void) => {
			if (name === "keydown") capture = listener;
		},
		fabrika: {
			send: (_port: string, message: FromPage) => sent.push(message),
			forget: () => {},
			onMessage: (port: string, listener: (raw: unknown) => void) => {
				if (port === "desk") hear = listener;
			},
		},
	});
	return {
		terminal,
		input,
		sent,
		typed,
		inserted,
		ready: () => capture !== undefined && hear !== undefined,
		send: (message: ToPage) => {
			if (hear === undefined) throw new Error("page did not hear the host");
			hear(message);
		},
		cover: (value: boolean) => (covered = value),
		clear: () => {
			sent.length = typed.length = inserted.length = 0;
		},
		press: (key: string, ctrlKey = false) =>
			page.activeElement.dispatchEvent(
				new PageKey("keydown", {key, code: `Key${key.toUpperCase()}`, ctrlKey, cancelable: true}),
			),
	};
};

const fold = (...msgs: DeskMsg[]): Open => {
	let desk = deskMachine.init(null, undefined)[0];
	for (const msg of msgs) desk = applyCell<Desk, DeskMsg, DeskCmd>(deskMachine, desk, msg)[0];
	if (desk.at !== "open") throw new Error("desk ended");
	return desk;
};
const host = {pid: 42, since: 0, build: "current", ledger: {kind: "own"}, agents: []} as const;
const asks: AsksNow = {asks: [], later: [], reach: "ok", why: null};
const props = (over: Partial<FrameProps> = {}): FrameProps => ({
	desk: fold(),
	frame: FRAME,
	asks,
	host,
	link: {kind: "up"},
	attachedOnce: true,
	keys: defaults,
	shapes: new Map(),
	tickets: new Map(),
	armed: false,
	toHost: () => {},
	toApp: () => {},
	toRun: () => {},
	step: () => {},
	...over,
});
const show = (over: Partial<FrameProps>) => renderToStaticMarkup(createElement(Over, props(over)));

describe("today's frame display laws", () => {
	it("shows attached agents only after the host answers, and marks only the active workspace", () => {
		const desk = fold({type: "run", does: 'tezgah."workspace --to new"'});
		const html = renderToStaticMarkup(createElement(TopBar, props({desk, host: null})));
		expect(
			[...html.matchAll(/data-item="workspace (\d+)"[^>]*aria-current="([^"]+)"/g)].map((match) => [
				match[1],
				match[2],
			]),
		).toEqual([
			["1", "false"],
			["2", "true"],
		]);
		expect(html).not.toContain('data-item="agents"');
		const attached = renderToStaticMarkup(
			createElement(
				TopBar,
				props({
					host: {...host, agents: [{name: "helper", since: 0, tile: null}]},
				}),
			),
		);
		expect(attached).toContain("1 agent");
	});

	it("a program in the top bar names the tsh command that focuses its tile", () => {
		const desk = fold({
			type: "covered",
			tile: "t1",
			runs: [
				{id: "tracker:1", program: "tracker"},
				{id: "ticket:1", program: "ticket"},
				{id: "trace:1", program: "trace"},
			],
		});
		const words: unknown[] = [];
		const walk = (node: unknown): void => {
			if (Array.isArray(node)) {
				for (const child of node) walk(child);
				return;
			}
			if (!isValidElement<Record<string, unknown>>(node)) return;
			if (node.props.name === "ticket") words.push(node.props.word);
			walk(node.props.children);
		};
		function Read(): ReactNode {
			const node = TopBar(props({desk}));
			walk(node);
			return node;
		}
		renderToStaticMarkup(createElement(Read));
		expect(words).toEqual(["focus --to t2"]);
	});

	it("the asks and jobs menus display their navigation and close keys", () => {
		const html = show({
			frame: {...FRAME, over: {kind: "asks"}},
			asks: {
				...asks,
				asks: [
					{
						key: "7/ask-1",
						ticket: 7,
						title: "Keys",
						what: "approve plan",
						kind: "ask",
						at: 0,
						seen: false,
					},
				],
			},
		});
		expect(html).toMatch(/↑<\/kbd>/);
		expect(html).toMatch(/↓<\/kbd>/);
		expect(html).toMatch(/↵<\/kbd>[\s\S]*?Open/);
		const jobs = show({
			frame: {...FRAME, over: {kind: "jobs"}},
			desk: {
				...fold(),
				jobs: {t1: {running: [{n: 1, text: "counter", since: 0, foreground: true}], ended: null}},
			},
		});
		expect(jobs).toMatch(/Esc<\/kbd>[\s\S]*?Close/);
	});

	it("the sync explanation keeps the failure reason and an older host names its build", () => {
		expect(
			show({
				frame: {...FRAME, over: {kind: "item", what: "sync"}},
				asks: {...asks, reach: "failed", why: "connection refused"},
			}),
		).toContain('<code class="pop-why">connection refused</code>');
		expect(
			show({
				frame: {...FRAME, over: {kind: "item", what: "host"}},
				link: {kind: "build", ours: "current", theirs: "older"},
			}),
		).toContain("It is build <code>older</code>");
	});

	it("K17: the palette opens before a desk arrives and running a command gives its key hint", () => {
		const stepped: FrameMsg[] = [];
		const sent: FrameProps["toHost"] extends (msg: infer M) => void ? M[] : never = [];
		const frame = frameUpdate(FRAME, {type: "palette"});
		expect(show({frame, desk: null})).toContain('<span class="chip">Keyboard shortcuts</span>');
		show({frame, step: (msg) => stepped.push(msg), toHost: (msg) => sent.push(msg)});
		const drawn = palette.props;
		if (drawn === null) throw new Error("palette did not render");
		const options = drawn.sections.flatMap((section) => section.options);
		const zoom = options.findIndex((option) => option.name === "zoom");
		expect(zoom).toBeGreaterThanOrEqual(0);
		drawn.onRun(zoom);
		expect(sent).toEqual([{type: "run", does: "tezgah.zoom"}]);
		expect(stepped).toEqual([{type: "ran", key: "C-b z"}]);
	});
});
