import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {backoff, type Link, linkTimer, startLink, stepLink} from "./link.ts";

const online = (): Link => {
	const dialing = startLink("30s", 7);
	const hello = stepLink(dialing, {type: "opened", dial: 1}).link;
	return stepLink(hello, {type: "welcome", result: {version: 1, ping: "30s"}}).link;
};

describe("backoff (T7)", () => {
	it("retries once at once", () => {
		expect(backoff(0, 0.5)).toBe(0);
	});

	it("then doubles from 250 ms", () => {
		expect(backoff(1, 0.5)).toBe(250);
		expect(backoff(2, 0.5)).toBe(500);
		expect(backoff(3, 0.5)).toBe(1000);
	});

	it("jitters each wait 80 to 120%", () => {
		fc.assert(
			fc.property(
				fc.integer({min: 1, max: 6}),
				fc.double({min: 0, max: 0.999, noNaN: true}),
				(t, r) => {
					const base = 250 * 2 ** (t - 1);
					const wait = backoff(t, r);
					return wait >= base * 0.8 && wait <= base * 1.2;
				},
			),
		);
	});

	it("never waits more than 30 s", () => {
		fc.assert(
			fc.property(
				fc.integer({min: 0, max: 60}),
				fc.double({min: 0, max: 0.999, noNaN: true}),
				(t, r) => {
					return backoff(t, r) <= 30_000;
				},
			),
		);
	});
});

describe("the link", () => {
	it("says hello when the socket opens, and is online once welcomed", () => {
		const hello = stepLink(startLink("30s", 7), {type: "opened", dial: 1});
		expect(hello.link.is).toBe("hello");
		expect(hello.send[0]).toContain('"initialize"');
		const up = stepLink(hello.link, {type: "welcome", result: {version: 1, ping: "2s"}});
		expect(up.online).toBe(true);
		expect(up.link).toMatchObject({is: "online", ping: 2000, tries: 0});
	});

	it("retries at once after a drop, then backs off, and dials anew", () => {
		const first = stepLink(online(), {type: "closed", dial: 1}).link;
		expect(first).toMatchObject({is: "waiting", wait: 0, tries: 1});
		const again = stepLink(first, {type: "retry", dial: 1}).link;
		expect(again).toMatchObject({is: "dialing", dial: 2});
		const second = stepLink(again, {type: "closed", dial: 2}).link;
		expect(second.is).toBe("waiting");
		expect(second).toMatchObject({tries: 2});
		if (second.is === "waiting") expect(second.wait).toBeGreaterThanOrEqual(200);
	});

	it("ignores a close from an old dial", () => {
		const link = online();
		expect(stepLink(link, {type: "closed", dial: 99}).link).toEqual(link);
	});

	it("pings, is happy with a pong, and drops the pipe with none", () => {
		const up = online();
		const due = stepLink(up, {type: "ping_due", beat: 0});
		expect(due.send).toEqual(["ping"]);
		expect(linkTimer(due.link)).toEqual({ms: 10_000, msg: {type: "pong_late", beat: 0}});
		expect(stepLink(due.link, {type: "pong"}).link).toMatchObject({beat: 1, pongDue: false});
		expect(stepLink(due.link, {type: "pong_late", beat: 0}).link.is).toBe("waiting");
	});

	it("gives up on a dial nobody answers", () => {
		const late = stepLink(startLink("30s", 7), {type: "dial_late", dial: 1}).link;
		expect(late.is).toBe("waiting");
	});
});
