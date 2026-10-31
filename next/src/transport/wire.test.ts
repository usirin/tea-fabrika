import {Option} from "effect";
import {describe, expect, it} from "vitest";
import {answerHello, clampPing, err, helloText, news, ok, readMessage} from "./wire.ts";

describe("the hello", () => {
	it("picks the highest shared version and keeps the ping inside the brain's limits", () => {
		expect(answerHello({versions: [1, 9], has: [], ping: "30s"})).toEqual({
			version: 1,
			ping: "30s",
		});
		expect(answerHello({versions: [1], has: [], ping: "500s"})).toEqual({version: 1, ping: "60s"});
		expect(answerHello({versions: [1], has: [], ping: "0s"})).toEqual({version: 1, ping: "1s"});
	});

	it("says why when it cannot answer", () => {
		expect(answerHello({versions: [9], has: [], ping: "30s"})).toEqual({why: "no_version"});
		expect(answerHello({nope: true})).toEqual({why: "bad_hello"});
	});

	it("is a JSON-RPC initialize", () => {
		expect(readMessage(helloText(["notify"], "30s"))).toEqual(
			Option.some({
				is: "ask",
				id: "hello",
				method: "initialize",
				params: {versions: [1], has: ["notify"], ping: "30s"},
			}),
		);
	});

	it("reads a ping it cannot parse as the default", () => {
		expect(clampPing("soon")).toBe("30s");
	});
});

describe("reading a message", () => {
	it("tells an answer, a failure and news apart", () => {
		expect(readMessage(ok("a", 1))).toEqual(Option.some({is: "ok", id: "a", result: 1}));
		expect(readMessage(err("a", "stale"))).toEqual(Option.some({is: "err", id: "a", why: "stale"}));
		expect(readMessage(news("view.patch", {rev: 1}))).toEqual(
			Option.some({is: "news", method: "view.patch", params: {rev: 1}}),
		);
	});

	it("ignores what it does not know", () => {
		expect(readMessage("pong")).toEqual(Option.none());
		expect(readMessage(JSON.stringify({kind: "later"}))).toEqual(Option.none());
	});
});
