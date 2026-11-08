import {applyCell} from "@demlik/tea";
import {Result} from "effect";
import {describe, expect, it} from "vitest";
import {fresh} from "./desk/desk.ts";
import {decodeKeys, defaults} from "./desk/keymap.ts";
import {linkMachine, PROTOCOL, readUp} from "./link.ts";
import {
	readFromPage,
	readFromTerminal,
	readFromWindow,
	readToApp,
	readToPage,
	readToTerminal,
	readToWindow,
} from "./messages.ts";

it("P30: completed commands replace raw key traffic and refuse a PR 1 peer", () => {
	const command = {
		type: "run",
		id: "command-1",
		target: {program: "tezgah", word: "split", mode: null, tile: "t1"},
		via: {_tag: "key", keys: "ctrl+b |"},
	};
	expect(readFromPage(command)).toEqual({kind: "read", msg: command});
	for (const raw of [
		{type: "press", id: 0, key: "<c-b>"},
		{type: "answer", id: 0, took: true},
	]) {
		expect(readFromPage(raw).kind).toBe("refused");
		expect(readToPage(raw).kind).toBe("refused");
	}
	for (const target of [
		null,
		{...command.target, tile: "../t1"},
		{...command.target, word: "typo"},
	])
		expect(readFromPage({...command, target}).kind).toBe("refused");
	expect(PROTOCOL).toBeGreaterThan(2);
	for (const side of ["app", "host"] as const) {
		const initial = linkMachine.init(null, {side, ours: PROTOCOL})[0];
		const [refused, cmds] = applyCell(linkMachine, initial, {type: "hello", version: 2});
		expect(refused.at).toBe("refused");
		expect(cmds).toContainEqual({type: "refuse", theirs: 2, ours: PROTOCOL});
		const [, delivery] = applyCell(linkMachine, refused, {type: "line", m: command});
		expect(delivery.some((c) => c.type === "deliver")).toBe(false);
	}
	expect(readUp({type: "on", port: "desk", m: command}).kind).toBe("read");
});

// The envelope of each message type, read strictly. What is inside a window's `msg` is read by
// its run's program, in tsh.test.ts.

describe("from the terminal", () => {
	it("reads keys and a size", () => {
		expect(readFromTerminal({type: "keys", data: "cou\t"})).toEqual({
			kind: "read",
			msg: {type: "keys", data: "cou\t"},
		});
		expect(readFromTerminal({type: "size", cols: 100, rows: 30}).kind).toBe("read");
	});

	it("is refused with a key it does not name, a size out of bounds, or a paste past 64 KiB", () => {
		expect(readFromTerminal({type: "keys", data: "x", to: "tsh"}).kind).toBe("refused");
		expect(readFromTerminal({type: "size", cols: 0, rows: 30}).kind).toBe("refused");
		expect(readFromTerminal({type: "size", cols: 80.5, rows: 30}).kind).toBe("refused");
		expect(readFromTerminal({type: "keys", data: "x".repeat(65537)}).kind).toBe("refused");
		expect(readFromTerminal("seq --to 3").kind).toBe("refused");
	});
});

describe("to the terminal", () => {
	it("reads bytes to write, and nothing else", () => {
		expect(readToTerminal({type: "write", data: "tsh$ "}).kind).toBe("read");
		expect(readToTerminal({type: "view", data: "tsh$ "}).kind).toBe("refused");
	});
});

describe("a program's window", () => {
	it("reads a view with its program's name, and sends a message for its run", () => {
		const view = {type: "view", program: "counter", data: {n: 0}};
		expect(readToWindow(view)).toEqual({kind: "read", msg: view});
		const m = {type: "msg", msg: {type: "press", value: "plus"}};
		expect(readFromWindow(m)).toEqual({kind: "read", msg: m});
	});

	it("is refused a message that names another run", () => {
		expect(readFromWindow({type: "msg", to: "tsh:p1", msg: null}).kind).toBe("refused");
		expect(readToWindow({type: "view", data: {n: 0}}).kind).toBe("refused");
	});
});

describe("the desk's port", () => {
	it("K21: editor requests and applied versions read strictly, with no sender identity from the client", () => {
		const edit = {
			type: "keys.edit",
			request: "edit-1",
			edit: {
				_tag: "bind",
				target: {program: "tezgah", word: "zoom", mode: null},
				keys: ["<prefix>m"],
			},
			said: 100,
		};
		expect(readFromPage(edit)).toEqual({kind: "read", msg: edit});
		for (const bad of [
			{...edit, by: "owner"},
			{...edit, at: 1},
			{...edit, edit: {_tag: "reset", target: {program: "tezgah", word: "zom", mode: null}}},
			{...edit, said: "yesterday"},
			{...edit, edit: {_tag: "undo"}},
		])
			expect(readFromPage(bad).kind).toBe("refused");
		expect(readToPage({type: "keys", ...defaults, version: "v1", changes: []}).kind).toBe("read");
	});
	it("sends the page the whole desk without raw-key routing state", () => {
		const desk = fresh();
		const sent = {type: "desk", desk};
		expect(readToPage(sent)).toEqual({kind: "read", msg: sent});
		expect(readToPage({type: "desk", desk: {at: "over"}}).kind).toBe("read");
		// A desk that breaks its own shape is not drawn.
		const broken = {...desk, workspaces: []};
		expect(readToPage({type: "desk", desk: broken}).kind).toBe("refused");
	});

	it("takes clicks, a border let go and folds from the page, and nothing that opens or stops a tile", () => {
		expect(readFromPage({type: "press", id: 0, key: "<c-b>", at: 12}).kind).toBe("refused");
		expect(readFromPage({type: "click", tile: "t2"}).kind).toBe("read");
		expect(readFromPage({type: "click", tile: "../t2"}).kind).toBe("refused");
		const sizes = {t1: 40, t2: 60};
		expect(readFromPage({type: "resize", container: "c1", sizes}).kind).toBe("read");
		expect(readFromPage({type: "resize", stack: "c1", sizes}).kind).toBe("refused");
		expect(readFromPage({type: "fold", tile: "t2"}).kind).toBe("read");
		expect(readFromPage({type: "fold", tile: "../t2"}).kind).toBe("refused");
		expect(readFromPage({type: "unfold", node: "c4"}).kind).toBe("read");
		expect(readFromPage({type: "open", tile: "t2"}).kind).toBe("refused");
		expect(readFromPage({type: "stop", tile: "t2"}).kind).toBe("refused");
		expect(readFromPage({type: "save", desk: {}}).kind).toBe("refused");
	});

	it("sends the page the keys file's table, and takes a palette run by its command word (ticket 174)", () => {
		const read = decodeKeys('prefix = "ctrl+a"', true);
		if (Result.isFailure(read)) throw new Error(read.failure.why);
		const sent = {type: "keys", ...read.success};
		expect(readToPage(sent)).toEqual({kind: "read", msg: sent});
		const refused = {
			...sent,
			file: {_tag: "refused", line: 2, why: "tezgah.zom is not a command"},
		};
		expect(readToPage(refused)).toEqual({kind: "read", msg: refused});
		// A row names a command the code lists, never a free string.
		const typo = {...sent, rows: [{does: "tezgah.zom", keys: [], source: "yours"}]};
		expect(readToPage(typo).kind).toBe("refused");
		// The old table, one row per key, is not read.
		expect(
			readToPage({
				type: "keys",
				prefix: "<c-b>",
				table: [{key: "|", repeats: false, name: "split", tsh: "split"}],
			}).kind,
		).toBe("refused");
		expect(
			readFromPage({
				type: "run",
				id: "zoom-1",
				target: {program: "tezgah", word: "zoom", mode: null, tile: "t1"},
				via: {_tag: "palette"},
			}).kind,
		).toBe("read");
		expect(readFromPage({type: "run", does: "tezgah.zom"}).kind).toBe("refused");
		expect(readFromPage({type: "run", key: "z"}).kind).toBe("refused");
	});

	it("tells the page what it shows of the link: what the app found, or how it is lost", () => {
		const why = "The link to the host ended: the other side closed.";
		const link = (now: unknown) => readToPage({type: "link", now}).kind;
		expect(link({kind: "up"})).toBe("read");
		expect(link({kind: "version", theirs: 1, ours: 2})).toBe("read");
		expect(link({kind: "build", theirs: "0ld0ld0ld0ld", ours: "n3wn3wn3wn3w"})).toBe("read");
		expect(link({kind: "build", theirs: null, ours: "n3wn3wn3wn3w"})).toBe("read");
		expect(link({kind: "reconnecting", why})).toBe("read");
		expect(link({kind: "stopped", why})).toBe("read");
		expect(link({kind: "restarting"})).toBe("read");
		// Each kind has what it names, and no more.
		expect(link({kind: "version", theirs: 1})).toBe("refused");
		expect(link({kind: "build", ours: "n3wn3wn3wn3w"})).toBe("refused");
		expect(link({kind: "reconnecting"})).toBe("refused");
		expect(link({kind: "up", why})).toBe("refused");
		expect(link({kind: "gone"})).toBe("refused");
		// The old shape is not read.
		expect(readToPage({type: "down", why, now: "reconnecting"}).kind).toBe("refused");
	});

	it("tells the page each agent attached, since when, and its own tile; a host that names no tile reads as none (tracker 185b)", () => {
		const now = (agents: unknown) => ({
			type: "host",
			now: {pid: 4121, since: 1793400000000, build: null, ledger: {kind: "own"}, agents},
		});
		expect(
			readToPage(
				now([
					{name: "claude", since: 1793400060000, tile: "t2"},
					{name: "lead", since: 1793400070000},
				]),
			),
		).toEqual({
			kind: "read",
			msg: now([
				{name: "claude", since: 1793400060000, tile: "t2"},
				{name: "lead", since: 1793400070000, tile: null},
			]),
		});
		expect(readToPage(now([{name: "claude", since: 1793400060000, tile: "../t2"}])).kind).toBe(
			"refused",
		);
	});

	it("tells the page who restarted the host and why, and still reads a host that says nothing of it (185b PR 5)", () => {
		const host = {pid: 4242, since: 0, build: null, ledger: {kind: "own"}, agents: []};
		const read = (now: unknown) => readToPage({type: "host", now}).kind;
		// made up: `restarted` and its fields; the plan names `HostNow.restarted` and restart.json's
		// `{by, why, at}`. An agent's restart says why; a person's, from the window, says none.
		const by = (who: string, why: string | null) => ({
			...host,
			restarted: {by: who, why, at: 1_767_225_600_000},
		});
		expect(read(by("agent:claude for:owner", "pick up the new build"))).toBe("read");
		expect(read(by("user:owner", null))).toBe("read");
		expect(read({...host, restarted: null})).toBe("read");
		// A host of an older build sends no `restarted`: the app attaches to it, so it still reads.
		expect(read(host)).toBe("read");
		expect(read({...host, restarted: {why: "pick up the new build", at: 0}})).toBe("refused");
	});

	it("takes Try again and the restart from the page for the app itself, and nothing more", () => {
		expect(readToApp({type: "again"})).toEqual({kind: "read", msg: {type: "again"}});
		expect(readToApp({type: "restart"})).toEqual({kind: "read", msg: {type: "restart"}});
		expect(readToApp({type: "again", now: true}).kind).toBe("refused");
		expect(readToApp({type: "restart", pid: 42}).kind).toBe("refused");
		expect(readToApp({type: "click", tile: "t2"}).kind).toBe("refused");
		// The host does not read them: neither reaches it as a message of its own.
		expect(readFromPage({type: "again"}).kind).toBe("refused");
		expect(readFromPage({type: "restart"}).kind).toBe("refused");
	});
});
