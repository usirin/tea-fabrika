import {applyCell} from "@demlik/tea";
import {askShownOf, sealAsk, type AskShown} from "@kampus/pipeline/tickets/ask";
import {AskActions, AskView} from "@tea-fabrika/tracker/ask-window";
import {Effect, Result} from "effect";
import fc from "fast-check";
import {act, createElement, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeAll, expect, it, vi} from "vitest";
import {DRAFT} from "../../../../fixtures/ask-desk/cases.ts";
import type {Ask} from "../asks.ts";
import {deskMachine, focusedOf, type Open} from "../desk/desk.ts";
import {decodeKeys, defaults, programCommandOn, type Keys} from "../desk/keymap.ts";
import {FRAME} from "./frame.ts";
import {Over, type FrameProps} from "./frame.tsx";

// Today's version. Review 4, findings 2, 3 and 4. Real React, tea machines, DOM focus and
// bubbling events. Only Manti's visual wrappers are replaced with their native controls.
// This small DOM host follows ask-status.ask-desk.test.ts; it does not claim browser or speech QA.
vi.mock("@manti-ui/react", async (original) => ({
	...(await original<typeof import("@manti-ui/react")>()),
	Button: ({size: _size, variant: _variant, ...props}: Record<string, unknown>) =>
		createElement("button", props),
	Kbd: ({size: _size, ...props}: Record<string, unknown>) => createElement("kbd", props),
	Textarea: ({
		label,
		hint: _hint,
		requiredIndicator: _required,
		resize: _resize,
		fullWidth: _full,
		...props
	}: Record<string, unknown>) =>
		createElement("textarea", {...props, "aria-label": String(label ?? "")}),
}));

type Press = Event & {key?: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean};
class DomElement {
	readonly nodeType: number;
	readonly tagName: string;
	readonly namespaceURI = "http://www.w3.org/1999/xhtml";
	readonly style = {setProperty() {}, removeProperty() {}};
	readonly attributes: Record<string, string> = {};
	readonly childNodes: DomElement[] = [];
	readonly listeners = new Map<string, {fn: EventListener; capture: boolean}[]>();
	parentNode: DomElement | null = null;
	value = "";
	disabled = false;
	tabIndex = 0;
	constructor(
		readonly nodeName: string,
		readonly ownerDocument: Dom,
		private text = "",
	) {
		this.nodeType = nodeName === "#text" ? 3 : 1;
		this.tagName = nodeName.toUpperCase();
	}
	addEventListener(type: string, fn: EventListener, options?: boolean) {
		this.listeners.set(type, [
			...(this.listeners.get(type) ?? []),
			{fn, capture: options === true},
		]);
	}
	removeEventListener(type: string, fn: EventListener) {
		this.listeners.set(
			type,
			(this.listeners.get(type) ?? []).filter((item) => item.fn !== fn),
		);
	}
	dispatchEvent(event: Event): boolean {
		Object.defineProperty(event, "target", {value: this, configurable: true});
		const path: DomElement[] = [this];
		for (let parent = this.parentNode; parent !== null; parent = parent.parentNode)
			path.push(parent);
		for (const capture of [true, false]) {
			for (const node of capture ? path.toReversed() : path) {
				for (const item of node.listeners.get(event.type) ?? []) {
					if (item.capture === capture) item.fn(event);
				}
				if (event.cancelBubble) return !event.defaultPrevented;
			}
		}
		return !event.defaultPrevented;
	}
	setAttribute(key: string, value: string) {
		this.attributes[key] = String(value);
	}
	setAttributeNS(_namespace: string, key: string, value: string) {
		this.setAttribute(key, value);
	}
	getAttribute(key: string) {
		return this.attributes[key] ?? null;
	}
	hasAttribute(key: string) {
		return Object.hasOwn(this.attributes, key);
	}
	removeAttribute(key: string) {
		delete this.attributes[key];
	}
	appendChild(child: DomElement) {
		child.parentNode?.removeChild(child);
		child.parentNode = this;
		this.childNodes.push(child);
		return child;
	}
	insertBefore(child: DomElement, before: DomElement) {
		child.parentNode?.removeChild(child);
		child.parentNode = this;
		this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
		return child;
	}
	removeChild(child: DomElement) {
		this.childNodes.splice(this.childNodes.indexOf(child), 1);
		child.parentNode = null;
		return child;
	}
	get firstChild() {
		return this.childNodes[0] ?? null;
	}
	get textContent(): string {
		return this.text + this.childNodes.map((child) => child.textContent).join("");
	}
	set textContent(text: string) {
		this.text = text;
		this.childNodes.splice(0);
	}
	get nodeValue() {
		return this.text;
	}
	set nodeValue(text: string) {
		this.text = text;
	}
	get id() {
		return this.attributes.id ?? "";
	}
	get isConnected(): boolean {
		return this === this.ownerDocument.body || this.parentNode?.isConnected === true;
	}
	get isContentEditable() {
		return false;
	}
	contains(node: DomElement | null): boolean {
		return node === this || this.childNodes.some((child) => child.contains(node));
	}
	matches(selector: string): boolean {
		const tag = /^[a-z]+/i.exec(selector)?.[0];
		if (tag !== undefined && tag.toUpperCase() !== this.tagName) return false;
		for (const [, name] of selector.matchAll(/\.([\w-]+)/g))
			if (!(this.attributes.class ?? "").split(" ").includes(name!)) return false;
		for (const [, key, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g))
			if (!this.hasAttribute(key!) || (value !== undefined && this.getAttribute(key!) !== value))
				return false;
		return true;
	}
	closest(selector: string): DomElement | null {
		return this.matches(selector) ? this : (this.parentNode?.closest(selector) ?? null);
	}
	querySelectorAll(selector: string): DomElement[] {
		return this.childNodes.flatMap((child) => [
			...(child.nodeType === 1 && child.matches(selector) ? [child] : []),
			...child.querySelectorAll(selector),
		]);
	}
	querySelector(selector: string): DomElement | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}
	focus() {
		if (this.ownerDocument.activeElement === this) return;
		this.ownerDocument.activeElement = this;
		this.dispatchEvent(new Event("focusin", {bubbles: true}));
	}
	scrollIntoView() {}
}
class Input extends DomElement {}
class Textarea extends DomElement {}
class Dom extends EventTarget {
	readonly nodeType = 9;
	readonly documentElement = {namespaceURI: "http://www.w3.org/1999/xhtml"};
	readonly defaultView = Object.assign(new EventTarget(), {
		HTMLElement: DomElement,
		HTMLIFrameElement: class {},
		matchMedia: () => ({matches: true}),
	});
	readonly body = new DomElement("body", this);
	activeElement = this.body;
	hidden = false;
	hasFocus() {
		return true;
	}
	createElement(name: string) {
		const Class = name === "textarea" ? Textarea : name === "input" ? Input : DomElement;
		return new Class(name, this);
	}
	createElementNS(_namespace: string, name: string) {
		return this.createElement(name);
	}
	createTextNode(text: string) {
		return new DomElement("#text", this, text);
	}
	getElementById(id: string) {
		return this.body.querySelectorAll("*").find((el) => el.id === id) ?? null;
	}
}

let sealed: AskShown;
beforeAll(async () => {
	sealed = askShownOf(await Effect.runPromise(sealAsk(DRAFT)));
});
afterEach(() => {
	vi.unstubAllGlobals();
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const mount = async (node: ReactNode) => {
	const document = new Dom();
	vi.stubGlobal("document", document);
	vi.stubGlobal("window", document.defaultView);
	vi.stubGlobal("HTMLElement", DomElement);
	vi.stubGlobal("Element", DomElement);
	vi.stubGlobal("HTMLInputElement", Input);
	vi.stubGlobal("HTMLTextAreaElement", Textarea);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	// @ts-expect-error This test host implements only the DOM calls these components use.
	const root: Root = createRoot(document.body);
	await act(async () => {
		root.render(node);
		await settle();
	});
	return {
		document,
		find: (selector: string) => {
			const found = document.body.querySelector(selector);
			if (found === null) throw new Error(`Missing ${selector}`);
			return found;
		},
		press: async (key: string) => {
			await act(async () => {
				const event: Press = Object.assign(
					new Event("keydown", {bubbles: true, cancelable: true}),
					{
						key,
						ctrlKey: false,
						altKey: false,
						metaKey: false,
						shiftKey: false,
						repeat: false,
					},
				);
				document.activeElement.dispatchEvent(event);
				document.defaultView.dispatchEvent(Object.assign(new Event("keyup"), {key}));
				await settle();
			});
		},
		click: async (element: DomElement) =>
			act(async () => {
				element.dispatchEvent(new Event("click", {bubbles: true}));
				await settle();
			}),
		close: async () =>
			act(async () => {
				root.unmount();
				await settle();
			}),
	};
};

const desk = (): Open => {
	const [initial] = deskMachine.init(null, undefined);
	const [open] = applyCell(deskMachine, initial, {
		type: "covered",
		tile: "t1",
		runs: [{id: "ticket:review4", program: "ticket"}],
	});
	if (open.at !== "open") throw new Error("The desk closed");
	return open;
};
const row = (ticket: number, kind: Ask["kind"] = "ask"): Ask => ({
	key: kind === "ask" ? `${ticket}/${sealed.ask}` : `${ticket}/stuck/r-build-5`,
	ticket,
	kind,
	title: "Read names in one form",
	what: kind === "ask" ? DRAFT.what : "Checks failed",
	...(kind === "ask" ? {sealed} : {}),
	resume: "build",
	at: 0,
	seen: false,
});
const menu = (ticket: number, keys = defaults, kind: Ask["kind"] = "ask") => {
	const toHost = vi.fn<FrameProps["toHost"]>();
	const answer = vi.fn<AskActions["answer"]>(() => Effect.fail({why: "The host is disconnected"}));
	const open = desk();
	const actions: AskActions = {
		answer,
		openLane: (ticket) => toHost({type: "open_lane", from: focusedOf(open)!.id, ticket}),
		later: (key) => toHost({type: "later", key}),
		blocked: () => false,
		command: (press, typing) => {
			const command = programCommandOn(keys, "ask", press.key, {
				focused: true,
				typing,
				prefix: false,
				platform: press.ctrl || press.alt || press.meta,
			});
			return command === undefined ? undefined : {key: press.key, value: command.value};
		},
		keys: Object.fromEntries(
			["rec", "not", "picks", "later"].map((name) => [
				name,
				keys.programs?.find((r) => r.does === `program.ask.${name}`)?.keys.map((k) => k.key) ?? [],
			]),
		) as AskActions["keys"],
	};
	const props: FrameProps = {
		desk: open,
		frame: {...FRAME, over: {kind: "asks"}},
		asks: {asks: [row(ticket, kind)], later: [], reach: "ok", why: null},
		host: null,
		link: {kind: "up"},
		attachedOnce: true,
		keys,
		shapes: new Map(),
		tickets: new Map([["ticket:review4", ticket]]),
		armed: false,
		toHost,
		toApp: () => {},
		toRun: () => {},
		step: () => {},
	};
	return {
		props,
		actions,
		answer,
		toHost,
		node: createElement(AskActions.Provider, {value: actions}, createElement(Over, props)),
	};
};
const table = (text: string): Keys => {
	const decoded = decodeKeys(text, true);
	if (Result.isFailure(decoded)) throw new Error(decoded.failure.why);
	return decoded.success;
};
const number = fc.integer({min: 1, max: 100_000});

// Plant already present: the focused grid handles no answer/evidence keys and hardcodes h.
it("from the menu's first focus, actions use the current key map and unbound actions have no key", async () => {
	await fc.assert(
		fc.asyncProperty(
			number,
			fc.uniqueArray(fc.constantFrom("a", "d", "e", "f", "g", "r", "s", "u", "v", "w"), {
				minLength: 4,
				maxLength: 4,
			}),
			async (ticket, remapped) => {
				const names = ["rec", "not", "picks", "later"] as const;
				const ordinary = ["y", "n", "o", "h"];
				const changed = table(
					names.map((name, i) => `program.ask.${name} = "${remapped[i]}"`).join("\n"),
				);
				const unbound = table(names.map((name) => `program.ask.${name} = []`).join("\n"));
				const results: {mode: string; key: string; actual: string; expected: string}[] = [];
				for (const [mode, keys, presses] of [
					["default", defaults, ordinary],
					["remapped", changed, remapped],
					["unbound", unbound, [...ordinary, ...remapped]],
					["old keys", changed, ordinary],
				] as const) {
					for (const [i, key] of [...presses, " "].entries()) {
						const subject = menu(ticket, keys);
						const test = await mount(subject.node);
						try {
							expect(test.document.activeElement).toBe(test.find('[role="grid"]'));
							subject.toHost.mockClear();
							await test.press(key);
							const card = test.find(".ask-view");
							const actual =
								subject.answer.mock.calls.length > 0
									? "rec"
									: subject.toHost.mock.calls.some(([msg]) => msg.type === "later")
										? "later"
										: card.getAttribute("data-ask-editor") === "note"
											? "not"
											: card.getAttribute("data-ask-editor") === "picks"
												? "picks"
												: test.find(".ask-evidence").hasAttribute("hidden")
													? "none"
													: "evidence";
							const expected =
								key === " "
									? "evidence"
									: mode === "unbound" || mode === "old keys"
										? "none"
										: names[i]!;
							results.push({mode, key, actual, expected});
							if (actual === "rec")
								expect(subject.answer.mock.calls[0]?.[0]).toMatchObject({
									ticket,
									ask: sealed.ask,
									answer: {_tag: "rec"},
									via: {took: {key}},
								});
						} finally {
							await test.close();
						}
					}
				}
				expect(results.filter((r) => r.actual !== r.expected)).toEqual([]);
			},
		),
		{seed: 119120, numRuns: 20},
	);
});

// Plant already present: failureWords replaces every named domain refusal with generic words.
it("the ask shows domain refusals verbatim and hides store and transport details", async () => {
	await fc.assert(
		fc.asyncProperty(number, async (ticket) => {
			const results: {why: string; actual: string; expected: string}[] = [];
			for (const [why, expected] of [
				[
					"SQLITE_BUSY: database is locked",
					"The ledger was busy, so nothing was saved. Your answer is kept.",
				],
				[
					"The host is disconnected",
					"fabrika's host is not connected, so nothing was saved. Your answer is kept.",
				],
				["The plan changed", "The plan changed"],
				[`Already answered: ${ticket}`, `Already answered: ${ticket}`],
				["The ask was withdrawn", "The ask was withdrawn"],
				["The ask expired", "The ask expired"],
				["The displayed question changed", "The displayed question changed"],
				["The answer is not offered by this ask", "The answer is not offered by this ask"],
				["The change head moved", "The change head moved"],
				["The sealed ask is missing", "The sealed ask is missing"],
			] as const) {
				const subject = menu(ticket);
				const actions = {...subject.actions, answer: () => Effect.fail({why})};
				const test = await mount(
					createElement(
						AskActions.Provider,
						{value: actions},
						createElement(AskView, {ticket, ask: sealed}),
					),
				);
				try {
					const take = test.document.body
						.querySelectorAll("button")
						.find((b) => b.textContent.startsWith("Take rec"));
					if (take === undefined) throw new Error("No Take rec button");
					await test.click(take);
					await vi.waitFor(() =>
						expect(test.find('[role="alert"]').textContent).toContain("Not saved."),
					);
					const actual = test.find('[role="alert"]').textContent;
					results.push({why, actual, expected});
					if (/SQLITE/.test(why)) expect(actual).not.toContain(why);
				} finally {
					await test.close();
				}
			}
			expect(results.filter((r) => !r.actual.includes(r.expected))).toEqual([]);
		}),
		{seed: 119120, numRuns: 20},
	);
});

// Plant already present: both button labels call the ticket-opening path, so Open lane sends go.
it("Open lane sends open_lane for the stopped ticket, and Open ticket opens its ticket", async () => {
	await fc.assert(
		fc.asyncProperty(number, async (ticket) => {
			for (const kind of ["ask", "stuck"] as const) {
				const subject = menu(ticket, defaults, kind);
				const test = await mount(subject.node);
				try {
					const label = kind === "stuck" ? "Open lane" : "Open ticket";
					const button = test.document.body
						.querySelectorAll("button")
						.find((b) => b.textContent.startsWith(label));
					if (button === undefined) throw new Error(`No ${label} button`);
					subject.toHost.mockClear();
					await test.click(button);
					expect(subject.toHost.mock.calls.map(([msg]) => msg)).toEqual(
						kind === "stuck"
							? [{type: "open_lane", from: focusedOf(subject.props.desk!)!.id, ticket}]
							: [{type: "go", tile: "t1"}],
					);
				} finally {
					await test.close();
				}
			}
		}),
		{seed: 119120, numRuns: 30},
	);
});
