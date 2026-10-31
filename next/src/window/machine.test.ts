import {applyCell} from "@demlik/tea";
import {describe, expect, it} from "vitest";
import {ask, news, ok} from "../transport/wire.ts";
import {type Model, type Msg, startWindow, windowMachine} from "./machine.ts";

const start = startWindow({peer: "w-1", ping: "30s", seed: 1, size: {w: 1280, h: 800}});
const machine = windowMachine(start);

type Sent = {readonly text: string};
const texts = (cmd: unknown): readonly string[] => {
	if (Array.isArray(cmd)) return cmd.flatMap(texts);
	if (cmd !== null && typeof cmd === "object" && "text" in cmd) {
		return [(cmd as Sent).text];
	}
	return [];
};

const step = (model: Model, msg: Msg) => {
	const [next, cmd] = applyCell(machine, model, msg);
	return {model: next, sent: texts(cmd)};
};

const whenOnline = (): Model => {
	const opened = step(start, {type: "opened", dial: 1}).model;
	const welcome = ok("hello", {version: 1, ping: "30s"});
	return step(opened, {type: "frame", text: welcome}).model;
};

const patch = (rev: number, n: number) =>
	news("view.patch", {
		pid: "counter:1",
		rev,
		patch: [{op: "replace", path: "/n", value: n}],
		ledger: rev,
	});
const whole = (rev: number, n: number) =>
	news("view.whole", {pid: "counter:1", rev, whole: {n}, ledger: rev});

describe("window machine", () => {
	it("says hello when the socket opens, then watches the desk once online", () => {
		const {model, sent} = step(start, {type: "opened", dial: 1});
		expect(sent[0]).toContain('"initialize"');
		const online = step(model, {type: "frame", text: ok("hello", {version: 1, ping: "30s"})});
		expect(online.model.link.is).toBe("online");
		expect(online.sent).toEqual([ask("open:desk:owner", "view.open", {pid: "desk:owner"})]);
	});

	it("takes a whole copy, then patches in order", () => {
		const a = step(whenOnline(), {type: "frame", text: whole(4, 4)}).model;
		const b = step(a, {type: "frame", text: patch(5, 5)}).model;
		expect(b.views["counter:1"]).toEqual({rev: 5, data: {n: 5}, ledger: 5});
	});

	it("ignores a patch it already has, and asks again after a gap", () => {
		const a = step(whenOnline(), {type: "frame", text: whole(4, 4)}).model;
		expect(step(a, {type: "frame", text: patch(4, 99)}).model).toBe(a);
		const gap = step(a, {type: "frame", text: patch(9, 9)});
		expect(gap.model.views["counter:1"]?.rev).toBe(4);
		expect(gap.sent).toEqual([ask("open:counter:1", "view.open", {pid: "counter:1"})]);
	});

	it("sends a press with the rev it saw, and drops it from the outbox on the answer", () => {
		const a = step(whenOnline(), {type: "frame", text: whole(4, 4)}).model;
		const press = step(a, {type: "press", pid: "counter:1", m: {type: "plus"}, said: "now"});
		expect(press.sent).toHaveLength(1);
		expect(press.sent[0]).toContain('"saw":4');
		expect(press.model.outbox).toHaveLength(1);
		const answered = step(press.model, {type: "frame", text: ok("w-1-1", {rev: 5})});
		expect(answered.model.outbox).toHaveLength(0);
	});

	it("keeps a press through a lost link, and resends it with the same id", () => {
		const online = whenOnline();
		const lost = step(online, {type: "closed", dial: 1}).model;
		expect(lost.link.is).toBe("waiting");
		const press = step(lost, {type: "press", pid: "counter:1", m: {type: "plus"}, said: "now"});
		expect(press.sent).toEqual([]);

		const redial = step(press.model, {type: "retry", dial: 1}).model;
		expect(redial.link.dial).toBe(2);
		const hello = step(redial, {type: "opened", dial: 2}).model;
		const back = step(hello, {type: "frame", text: ok("hello", {version: 1, ping: "30s"})});
		expect(back.sent.some((text) => text.includes('"id":"w-1-1"'))).toBe(true);
	});

	it("after a reconnect asks for every view again", () => {
		const desk = {
			workspaces: [
				{
					n: 1,
					focus: "t1",
					layout: {
						dir: "row",
						parts: [{percent: 100, inner: {id: "t1", shows: "counter:1", keep: "failed"}}],
					},
				},
			],
		};
		const text = news("view.whole", {pid: "desk:owner", rev: 0, whole: desk, ledger: 0});
		const first = step(whenOnline(), {type: "frame", text});
		expect(first.sent).toEqual([ask("open:counter:1", "view.open", {pid: "counter:1"})]);

		const lost = step(first.model, {type: "closed", dial: 1}).model;
		const redial = step(lost, {type: "retry", dial: 1}).model;
		const hello = step(redial, {type: "opened", dial: 2}).model;
		const back = step(hello, {type: "frame", text: ok("hello", {version: 1, ping: "30s"})}).model;
		const again = step(back, {type: "frame", text});
		expect(again.sent).toEqual([ask("open:counter:1", "view.open", {pid: "counter:1"})]);
	});

	it("keeps its size to itself", () => {
		const resized = step(whenOnline(), {type: "resized", size: {w: 420, h: 800}});
		expect(resized.model.size).toEqual({w: 420, h: 800});
		expect(resized.sent).toEqual([]);
	});
});
