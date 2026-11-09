import {useMachine} from "@demlik/tea/react";
import {Asked, blindDraw, sealAsk} from "@kampus/pipeline/tickets/ask";
import {AskActions, AskStatus, AskView} from "@tea-fabrika/tracker/ask-window";
import {Deferred, Effect, Schema} from "effect";
import {
	cloneElement,
	createElement,
	type Context,
	type ReactElement,
	type ReactNode,
	useContext,
} from "react";
import {flushSync} from "react-dom";
import {createRoot} from "react-dom/client";
import {afterEach, describe, expect, vi} from "vitest";
import {DRAFT, policyFor} from "../../../fixtures/ask-desk/cases.ts";
import {property} from "../../../fixtures/ask-desk/property.ts";

// Observe the real tea hook, without replacing its state or dispatch behavior.
vi.mock("@demlik/tea/react", async (original) => {
	const actual = await original<typeof import("@demlik/tea/react")>();
	return {...actual, useMachine: vi.fn(actual.useMachine)};
});

// Today's version. Plan trace: "polite status: Approved. N left." Review 3 found that a
// second Approved. is silent. Run the real React renderer and AskStatus on a small DOM host.
// The host records DOM writes, not renders: setting the same text again is not an announcement.
// This checks the DOM contract only. Speech still needs the driver's VoiceOver run.
class Element {
	readonly nodeType: number;
	readonly tagName: string;
	readonly namespaceURI = "http://www.w3.org/1999/xhtml";
	readonly style = {};
	readonly attributes: Record<string, string> = {};
	readonly childNodes: Element[] = [];
	readonly listeners = new Map<string, ((event: unknown) => void)[]>();
	parentNode: Element | null = null;
	constructor(
		readonly nodeName: string,
		readonly ownerDocument: Dom,
		private text = "",
	) {
		this.nodeType = nodeName === "#text" ? 3 : 1;
		this.tagName = nodeName.toUpperCase();
	}
	addEventListener(type: string, listener: (event: unknown) => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}
	removeEventListener() {}
	setAttribute(key: string, value: string) {
		this.attributes[key] = value;
	}
	removeAttribute(key: string) {
		delete this.attributes[key];
	}
	appendChild(child: Element) {
		child.parentNode = this;
		this.childNodes.push(child);
		this.changed();
		return child;
	}
	insertBefore(child: Element, before: Element) {
		child.parentNode = this;
		this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
		this.changed();
	}
	removeChild(child: Element) {
		this.childNodes.splice(this.childNodes.indexOf(child), 1);
		child.parentNode = null;
		this.changed();
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
		this.changed();
	}
	get nodeValue() {
		return this.text;
	}
	set nodeValue(text: string) {
		this.text = text;
		this.changed();
	}
	contains(node: Element | null): boolean {
		return node === this || this.childNodes.some((child) => child.contains(node));
	}
	closest(selector: string): Element | null {
		const matches = selector.startsWith(".")
			? this.attributes.class?.split(" ").includes(selector.slice(1))
			: this.nodeName === selector;
		return matches ? this : (this.parentNode?.closest(selector) ?? null);
	}
	focus() {
		this.ownerDocument.activeElement = this;
	}
	find(matches: (node: Element) => boolean): Element[] {
		return [...(matches(this) ? [this] : []), ...this.childNodes.flatMap((c) => c.find(matches))];
	}
	click() {
		this.bubbleClick({type: "click", target: this, button: 0, bubbles: true});
	}
	private bubbleClick(event: unknown) {
		for (const listener of this.listeners.get("click") ?? []) listener(event);
		this.parentNode?.bubbleClick(event);
	}
	private changed() {
		if (this.attributes.role === "status") this.ownerDocument.writes++;
		else this.parentNode?.changed();
	}
	findStatus(): Element | undefined {
		return this.attributes.role === "status"
			? this
			: this.childNodes.flatMap((child) => child.findStatus() ?? [])[0];
	}
}
class Dom {
	readonly nodeType = 9;
	readonly documentElement = {namespaceURI: "http://www.w3.org/1999/xhtml"};
	readonly defaultView = {
		HTMLElement: Element,
		HTMLIFrameElement: class {},
		addEventListener() {},
		removeEventListener() {},
	};
	readonly body = new Element("body", this);
	activeElement = this.body;
	readonly hidden = false;
	writes = 0;
	hasFocus() {
		return true;
	}
	addEventListener() {}
	removeEventListener() {}
	createElement(name: string) {
		return new Element(name, this);
	}
	createElementNS(_namespace: string, name: string) {
		return this.createElement(name);
	}
	createTextNode(text: string) {
		return new Element("#text", this, text);
	}
}

type Say = (words: string) => void;
type StatusProps = {readonly children: ReactNode; readonly left: number};
const status: (props: StatusProps) => ReactElement<{children: ReactNode}> = AskStatus;
const mount = (left: number) => {
	const document = new Dom();
	vi.stubGlobal("document", document);
	vi.stubGlobal("window", document.defaultView);
	// @ts-expect-error The test host supplies only the DOM calls this component uses.
	const root = createRoot(document.body);
	let say: Say | null = null;
	function Capture({context}: {context: Context<Say | null>}) {
		say = useContext(context);
		return null;
	}
	function Subject() {
		const tree = status({children: null, left});
		return cloneElement(
			tree,
			{},
			createElement(Capture, {context: tree.type as Context<Say | null>}),
			tree.props.children,
		);
	}
	flushSync(() => root.render(createElement(Subject)));
	return {
		document,
		announce: (words: string) => flushSync(() => say?.(words)),
		close: () => flushSync(() => root.unmount()),
	};
};
afterEach(async () => {
	// React's pending passive cleanup still reads window after an unmount.
	await new Promise<void>((resolve) => setImmediate(resolve));
	vi.unstubAllGlobals();
});

const left = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100));
const repeats = Schema.Int.check(Schema.isGreaterThanOrEqualTo(2), Schema.isLessThanOrEqualTo(8));

// Review 5, finding 6. elm-first.md requires today's component state to live in tea.
// Plant present: AskStatus uses React state, so no tea model changes when a saying arrives.
// This observes the running model and repeated DOM announcements, not the component's source text.
property(
	"each repeated status changes its tea model and announces again",
	{left, repeats},
	async ({left, repeats}) => {
		vi.mocked(useMachine).mockClear();
		const test = mount(left);
		try {
			expect(
				useMachine,
				"AskStatus keeps no announcement state in a tea machine",
			).toHaveBeenCalled();
			for (let i = 0; i < repeats; i++) {
				const before = vi.mocked(useMachine).mock.results.at(-1)?.value[0];
				const writes = test.document.writes;
				test.announce("Approved.");
				await new Promise<void>((resolve) => setImmediate(resolve));
				const after = vi.mocked(useMachine).mock.results.at(-1)?.value[0];
				expect(after).not.toEqual(before);
				expect(JSON.stringify(after), "the tea model must hold the announcement").toContain(
					"Approved.",
				);
				expect(test.document.body.findStatus()?.textContent).toBe(`Approved. ${left} left.`);
				expect(test.document.writes).toBeGreaterThan(writes);
			}
		} finally {
			test.close();
		}
	},
);

property(
	"each accepted answer changes the live region even when its words repeat",
	{repeats},
	async ({repeats}) => {
		const test = mount(0);
		try {
			for (let i = 0; i < repeats; i++) {
				const before = test.document.writes;
				test.announce("Approved.");
				await new Promise<void>((resolve) => setImmediate(resolve));
				expect(test.document.body.findStatus()?.textContent).toContain("Approved.");
				expect(
					test.document.writes,
					`answer ${i + 1} made no live-region DOM change`,
				).toBeGreaterThan(before);
			}
		} finally {
			test.close();
		}
	},
);

property("an accepted answer says how many asks are left", {left}, async ({left}) => {
	const test = mount(left);
	try {
		test.announce("Approved.");
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(test.document.body.findStatus()?.textContent).toBe(`Approved. ${left} left.`);
	} finally {
		test.close();
	}
});

// Today's version, round 25, review 11, P24. The current product is the plant: save success
// says "Approved. N left." against the old queue, then a poll changes that same live result.
// Run the real AskView save, tea hooks, AskStatus and React DOM. Only the outside answer reply
// and ledger poll are controlled, so either can finish first, including after the view unmounts.
const waiting = Schema.UniqueArray(Asked.fields.ask).check(
	Schema.isMinLength(1),
	Schema.isMaxLength(4),
);
const choice = Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 3}));
const drain = async () => {
	await new Promise<void>((resolve) => setImmediate(resolve));
	flushSync(() => {});
	await new Promise<void>((resolve) => setImmediate(resolve));
};
const mountAnswer = (asks: readonly Asked[], selected: Asked) => {
	const document = new Dom();
	vi.stubGlobal("document", document);
	vi.stubGlobal("window", document.defaultView);
	// @ts-expect-error The test host supplies only the DOM calls the shared ask view uses.
	const root = createRoot(document.body);
	const started = Deferred.makeUnsafe<void>();
	const reply = Deferred.makeUnsafe<null>();
	const answers: string[] = [];
	const actions: AskActions = {
		openLane: () => {},
		command: () => undefined,
		answer: (answer) =>
			Effect.gen(function* () {
				answers.push(answer.ask);
				yield* Deferred.succeed(started, undefined);
				return yield* Deferred.await(reply);
			}),
		later: () => {},
		keys: {rec: ["y"], not: ["n"], picks: ["o"], later: ["h"]},
		blocked: () => false,
	};
	const render = (queue: readonly Asked[]) => {
		const ask = queue.find((ask) => ask.ask === selected.ask) ?? queue[0];
		flushSync(() =>
			root.render(
				createElement(
					AskActions.Provider,
					{value: actions},
					createElement(AskStatus, {
						left: queue.length,
						children:
							ask === undefined ? null : createElement(AskView, {key: ask.ask, ticket: 102, ask}),
					}),
				),
			),
		);
	};
	render(asks);
	return {
		document,
		answers,
		start: async () => {
			const button = document.body.find(
				(node) => node.tagName === "BUTTON" && node.textContent.startsWith("Take rec"),
			)[0];
			expect(button, "the selected ask must offer its recommendation").toBeDefined();
			flushSync(() => button!.click());
			await Effect.runPromise(Deferred.await(started));
			await drain();
		},
		save: async () => {
			await Effect.runPromise(Deferred.succeed(reply, null));
			await drain();
		},
		poll: async () => {
			render(asks.filter((ask) => ask.ask !== selected.ask));
			await drain();
		},
		close: () => flushSync(() => root.unmount()),
	};
};

describe.each(["save-first", "poll-first"] as const)("answer status with %s", (order) => {
	property(
		"one answer announces once with the answered ask excluded from the remaining count",
		{waiting, choice},
		async ({waiting, choice}) => {
			const asks = await Promise.all(
				waiting.map((ask) =>
					Effect.runPromise(sealAsk({...DRAFT, ask}, policyFor(ask, false, blindDraw))),
				),
			);
			const selected = asks[choice % asks.length]!;
			const test = mountAnswer(asks, selected);
			try {
				const announcements: string[] = [];
				let writes = test.document.writes;
				const record = () => {
					if (test.document.writes === writes) return;
					announcements.push(test.document.body.findStatus()?.textContent ?? "");
					writes = test.document.writes;
				};
				await test.start();
				expect(test.answers).toEqual([selected.ask]);
				record();
				expect(announcements, "a pending answer must stay silent").toEqual([]);
				if (order === "poll-first") {
					await test.poll();
					record();
					expect(announcements, "a poll must not announce an unconfirmed answer").toEqual([]);
				}
				await test.save();
				record();
				await test.poll();
				record();
				// Another identical poll must not repeat or revise the saved answer's result.
				await test.poll();
				record();
				expect(
					announcements,
					`${order}: one save must announce once, counting only unanswered asks`,
				).toEqual([`Approved. ${asks.length - 1} left.`]);
			} finally {
				test.close();
				await drain();
			}
		},
	);
});
