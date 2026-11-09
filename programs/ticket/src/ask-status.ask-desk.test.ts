import {it} from "@effect/vitest";
import {AskStatus} from "@tea-fabrika/tracker/ask-window";
import {Schema} from "effect";
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
import {afterEach, expect, vi} from "vitest";

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
	parentNode: Element | null = null;
	constructor(
		readonly nodeName: string,
		readonly ownerDocument: Dom,
		private text = "",
	) {
		this.nodeType = nodeName === "#text" ? 3 : 1;
		this.tagName = nodeName.toUpperCase();
	}
	addEventListener() {}
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
	readonly defaultView = {HTMLElement: Element, HTMLIFrameElement: class {}};
	readonly body = new Element("body", this);
	activeElement = this.body;
	writes = 0;
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

it.prop(
	"each accepted answer changes the live region even when its words repeat",
	{repeats},
	({repeats}) => {
		const test = mount(0);
		try {
			for (let i = 0; i < repeats; i++) {
				const before = test.document.writes;
				test.announce("Approved.");
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
	{arbitrary: {seed: 119120}},
);

it.prop(
	"an accepted answer says how many asks are left",
	{left},
	({left}) => {
		const test = mount(left);
		try {
			test.announce("Approved.");
			expect(test.document.body.findStatus()?.textContent).toBe(`Approved. ${left} left.`);
		} finally {
			test.close();
		}
	},
	{arbitrary: {seed: 119120}},
);
