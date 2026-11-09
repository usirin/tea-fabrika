import {applyCell} from "@demlik/tea";
import {foldEvents} from "@demlik/tea/pbt";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	foundOf,
	type Link,
	type LinkCmd,
	type LinkCtx,
	type LinkMsg,
	linkMachine,
	linkMsgOf,
	readDown,
	readUp,
	PROTOCOL,
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
	it("K21: today's new protocol refuses the old version in both directions before delivery", () => {
		expect(PROTOCOL).toBeGreaterThan(1);
		for (const side of ["app", "host"] as const) {
			const {s, steps} = fold({side, ours: PROTOCOL}, [
				{type: "hello", version: 1},
				{type: "line", m: {type: "keys.edit", edit: {_tag: "reset", does: "tezgah.zoom"}}},
			]);
			expect(s.at).toBe("refused");
			expect(steps.flat().some((cmd) => cmd.type === "deliver")).toBe(false);
			expect(steps[1]).toContainEqual({type: "refuse", theirs: 1, ours: PROTOCOL});
			const old = fold({side, ours: 1}, [
				{type: "hello", version: PROTOCOL},
				{type: "line", m: {type: "page"}},
			]);
			expect(old.s.at).toBe("refused");
			expect(old.steps.flat().some((cmd) => cmd.type === "deliver")).toBe(false);
		}
	});
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

	it("reads the build in the host's hello, or none; a hello to the host that names one is bad", () => {
		expect(readDown({type: "hello", version: 1, build: "3f9a0c21b7d4"}).kind).toBe("read");
		expect(readDown({type: "hello", version: 1}).kind).toBe("read");
		expect(readDown({type: "hello", version: 1, build: 7}).kind).toBe("refused");
		// A host reads strictly, so the app's hello names no build: one built before would refuse it.
		expect(linkMsgOf(readUp({type: "hello", version: 1, build: "3f9a0c21b7d4"})).type).toBe("bad");
	});

	it("compares the host's build with the app's: the same, another, or none named", () => {
		expect(foundOf("3f9a0c21b7d4", "3f9a0c21b7d4")).toEqual({kind: "up"});
		expect(foundOf("0ld0ld0ld0ld", "3f9a0c21b7d4")).toEqual({
			kind: "build",
			theirs: "0ld0ld0ld0ld",
			ours: "3f9a0c21b7d4",
		});
		expect(foundOf(null, "3f9a0c21b7d4")).toEqual({
			kind: "build",
			theirs: null,
			ours: "3f9a0c21b7d4",
		});
	});
});

describe("T204 PR 1 today's layer protocol version", () => {
	it("refuses the pre-layer protocol before delivering any recording message, on either side", () => {
		fc.assert(
			fc.property(fc.constantFrom("app" as const, "host" as const), fc.uuid(), (side, id) => {
				expect(PROTOCOL).toBeGreaterThan(2);
				const record = {
					type: "layer",
					id,
					instance: "instance-1",
					said: null,
					change: {_tag: "open", layer: {_tag: "palette"}, via: null},
				};
				for (const [ours, theirs] of [
					[PROTOCOL, 2],
					[2, PROTOCOL],
				] as const) {
					const trace = foldEvents(linkMachine, {side, ours}, null, [
						{type: "hello", version: theirs},
						{type: "line", m: record},
					]);
					expect(trace.finalState.at).toBe("refused");
					expect(trace.steps.flatMap((s) => s.cmds).filter((c) => c.type === "deliver")).toEqual(
						[],
					);
				}
			}),
			{seed: 119120},
		);
	});
	it("carries a checked layer report on the existing page port without rewriting it", () => {
		fc.assert(
			fc.property(fc.uuid(), fc.integer({min: 0}), (id, said) => {
				const msg = {
					type: "layer",
					id,
					instance: "instance-1",
					said,
					change: {_tag: "open", layer: {_tag: "palette"}, via: {_tag: "click"}},
				};
				const up = readUp({type: "on", port: "desk", m: msg});
				expect(up).toEqual({kind: "read", msg: {type: "on", port: "desk", m: msg}});
			}),
			{seed: 119120},
		);
	});
});
