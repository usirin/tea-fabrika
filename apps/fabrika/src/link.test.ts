import {applyCell} from "@demlik/tea";
import {describe, expect, it} from "vitest";
import {
	type Link,
	type LinkCmd,
	type LinkCtx,
	type LinkMsg,
	linkMachine,
	linkMsgOf,
	readDown,
	readUp,
} from "./link.ts";

// The link's handshake, folded by hand for each side, and the lines each side reads.

const fold = (ctx: LinkCtx, msgs: readonly LinkMsg[]) => {
	const [first, init] = linkMachine.init(null, ctx);
	let s: Link = first;
	const steps: (readonly LinkCmd[])[] = [init];
	for (const msg of msgs) {
		const [next, cmds] = applyCell<Link, LinkMsg, LinkCmd>(linkMachine, s, msg);
		s = next;
		steps.push(cmds);
	}
	return {s, steps};
};

const APP: LinkCtx = {side: "app", ours: 1};
const HOST: LinkCtx = {side: "host", ours: 1};

describe("the link", () => {
	it("is up on the app's side when the host says hello with the same version", () => {
		const {s, steps} = fold(APP, [
			{type: "hello", version: 1},
			{type: "line", m: {type: "close"}},
		]);
		expect(steps[0]).toEqual([{type: "greet", version: 1}]);
		expect(s.at).toBe("up");
		expect(steps[2]).toEqual([{type: "deliver", m: {type: "close"}}]);
	});

	it("greets back on the host's side, and says nothing first", () => {
		const {s, steps} = fold(HOST, [{type: "hello", version: 1}]);
		expect(steps[0]).toEqual([]);
		expect(steps[1]).toEqual([{type: "greet", version: 1}]);
		expect(s.at).toBe("up");
	});

	it("refuses another version: the host still greets back, so the app learns which it met", () => {
		const host = fold(HOST, [{type: "hello", version: 2}]);
		expect(host.s).toEqual({...HOST, at: "refused", theirs: 2});
		expect(host.steps[1]?.map((c) => c.type)).toEqual(["greet", "refuse", "drop"]);
		const app = fold(APP, [
			{type: "hello", version: 0},
			{type: "line", m: {type: "page"}},
		]);
		expect(app.s.at).toBe("refused");
		expect(app.steps[1]).toContainEqual({type: "refuse", theirs: 0, ours: 1});
		// Refused, a line after changes nothing, and is not handed on.
		expect(app.steps[2]).toEqual([]);
	});

	it("closes on a line before the hello, a second hello, or a line that does not read", () => {
		expect(fold(HOST, [{type: "line", m: {type: "page"}}]).s.at).toBe("closed");
		expect(
			fold(HOST, [
				{type: "hello", version: 1},
				{type: "hello", version: 1},
			]).s.at,
		).toBe("closed");
		const bad = fold(APP, [
			{type: "hello", version: 1},
			{type: "bad", why: "no"},
		]);
		expect(bad.s.at).toBe("closed");
		expect(bad.steps[2]?.map((c) => c.type)).toEqual(["drop"]);
	});

	it("reads each side's lines strictly", () => {
		expect(linkMsgOf(readUp({type: "hello", version: 1}))).toEqual({type: "hello", version: 1});
		expect(
			linkMsgOf(readUp({type: "on", port: "tile:t1", m: {type: "keys", data: "l"}})).type,
		).toBe("line");
		// A port's name is read as the page's bridge reads it: nothing else is a port.
		expect(linkMsgOf(readUp({type: "on", port: "../t1", m: null})).type).toBe("bad");
		expect(linkMsgOf(readDown({type: "page"})).type).toBe("bad");
		expect(linkMsgOf(readDown({type: "gone", port: "run:counter:1a2b"})).type).toBe("line");
	});
});
