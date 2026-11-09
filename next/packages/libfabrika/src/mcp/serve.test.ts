// P25 G, next/. Actual SDK transport against the product serveBridge in another process.
import {spawn} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {afterAll, expect, it} from "@effect/vitest";
import {Client} from "@modelcontextprotocol/client";
import {StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {Effect, Schema} from "effect";
import {options} from "./mcp.test-support.ts";

const homes: string[] = [];
const home = () => {
	const h = mkdtempSync("/tmp/fh.");
	homes.push(h);
	return h;
};
afterAll(() => {
	for (const h of homes) rmSync(h, {recursive: true, force: true});
});
const entry = join(import.meta.dirname, "serve.test-support.ts");
const connect = async (h: string, phase = "normal", modern = false) => {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [entry, phase],
		env: {PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", FABRIKA_HOME: h},
		stderr: "pipe",
	});
	const client = new Client(
		{name: "p25-exam", version: "1"},
		{versionNegotiation: {mode: modern ? {pin: "2026-07-28"} : "legacy"}},
	);
	await client.connect(transport);
	return {client, transport};
};
const discoveryLaw = (names: ReadonlyArray<string>, waiting: unknown, after: unknown) => {
	expect(names).toEqual(["ps", "notes_save", "notes_read", "notes_list"]);
	expect(waiting).toMatchObject({isError: true});
	expect(JSON.stringify(waiting)).toContain("482 109");
	expect(after).not.toMatchObject({isError: true});
};
for (const modern of [false, true])
	it(`scenario: L07 discovery precedes approval through ${modern ? "2026-07-28" : "legacy"} SDK process`, async () => {
		// Client startup behavior needs the outside process. Actual Claude is separately driven by experiment 238.
		const h = home();
		const {client} = await connect(h, "normal", modern);
		try {
			const listed = await client.listTools();
			const waiting = await client.callTool({name: "ps", arguments: {}});
			writeFileSync(join(h, "approved"), "");
			const admitted = await client.callTool({name: "ps", arguments: {}});
			discoveryLaw(
				listed.tools.map((t) => t.name),
				waiting,
				admitted,
			);
			expect(client.getProtocolEra()).toBe(modern ? "modern" : "legacy");
		} finally {
			await client.close();
		}
	});
const waitFile = async (path: string) => {
	while (!existsSync(path)) await new Promise<void>((r) => setTimeout(r, 10));
};
it.effect.prop(
	"L05 malformed SDK calls return errors and keep the server available",
	{args: Schema.Json},
	({args}) =>
		Effect.gen(function* () {
			const h = home();
			writeFileSync(join(h, "approved"), "");
			const {client} = yield* Effect.promise(() => connect(h));
			try {
				const reply = yield* Effect.tryPromise({
					try: () => client.callTool({name: "notes_save", arguments: {value: {bad: args}}}),
					catch: () => new Error("SDK call failed"),
				});
				expect(reply).toMatchObject({isError: true});
				expect(
					yield* Effect.promise(() => client.callTool({name: "ps", arguments: {}})),
				).not.toMatchObject({isError: true});
			} finally {
				yield* Effect.promise(() => client.close());
			}
		}),
	options,
);
const cleanupLaw = (closed: boolean, before: string | undefined, after: string | undefined) => {
	expect(closed, "client scope closed").toBe(true);
	expect(after, "reserved identity survives cancellation").toBe(before);
};
for (const phase of ["before", "reserved", "appended"] as const)
	it(`scenario: L26 cancellation at ${phase} releases transport and preserves retry identity`, async () => {
		// Ordered transport cancellation must happen in an outside process at each append boundary.
		const h = home();
		writeFileSync(join(h, "approved"), "");
		const {client} = await connect(h, phase);
		try {
			const abort = new AbortController();
			const call = client.callTool(
				{name: "notes_save", arguments: {value: {note: "n", base: 0, body: "body"}}},
				{signal: abort.signal},
			);
			await waitFile(
				join(h, phase === "before" ? "opened" : phase === "reserved" ? "requests" : "appended"),
			);
			abort.abort();
			await expect(call).rejects.toThrow();
			// A canceled call must release the single call permit.
			expect(await client.callTool({name: "ps", arguments: {}})).not.toMatchObject({isError: true});
		} finally {
			await client.close();
		}
		const before = existsSync(join(h, "requests"))
			? JSON.parse(readFileSync(join(h, "requests"), "utf8").split("\n")[0]!).letter
			: undefined;
		const next = await connect(h);
		try {
			await next.client.callTool({
				name: "notes_save",
				arguments: {value: {note: "n", base: 0, body: "body"}},
			});
		} finally {
			await next.client.close();
		}
		const after = existsSync(join(h, "requests"))
			? JSON.parse(readFileSync(join(h, "requests"), "utf8").trim().split("\n").at(-1)!).letter
			: undefined;
		if (phase === "before") expect(after).toMatch(/^letter_/);
		else cleanupLaw(existsSync(join(h, "closed")), before, after);
	});
it("scenario: L26 EOF closes the SDK handle and client scope", async () => {
	// Actual stdin EOF, rather than an in-memory cancellation signal.
	const h = home(),
		child = spawn(process.execPath, [entry], {
			env: {PATH: process.env.PATH, HOME: process.env.HOME, FABRIKA_HOME: h},
			stdio: ["pipe", "pipe", "pipe"],
		});
	const exited = new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", resolve);
	});
	try {
		child.stdin.end();
		expect(await exited).toBe(0);
		expect(existsSync(join(h, "closed"))).toBe(true);
	} finally {
		child.kill();
	}
});
it("plant L07: server holds discovery until approval", () =>
	expect(() => discoveryLaw([], {isError: true}, {content: []})).toThrow());
it("plant L26: leaked connection or replaced reserved ID", () => {
	expect(() => cleanupLaw(false, "letter-a", "letter-a")).toThrow();
	expect(() => cleanupLaw(true, "letter-a", "letter-b")).toThrow();
});
