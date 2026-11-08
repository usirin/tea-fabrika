// P19, next/. The window bridge (plan "Electron and preload contract" and "Laws"): a request
// decodes through the typed path, a signature binds the configured URL, tab, top frame and
// window, and the renderer's ClientKey decodes every bridge reply, so a page gets public identity
// and bound hello proofs only, never a private key or a signature over bytes of its choosing.
//
// The preload itself needs Electron; its half of p30 runs in `next/apps/fabrika/e2e/electron.test.ts`.
import {describe, expect, it} from "@effect/vitest";
import type {Context} from "effect";
import {Effect, Exit, Layer, Stream} from "effect";
import * as fc from "fast-check";
import type * as Bridge from "./bridge.ts";
import {SEED, typeIdArb, windowKeyArb} from "./desktop.test-support.ts";

const load = async <T>(spec: string, path: string, names: ReadonlyArray<keyof T>): Promise<T> => {
	const mod: Partial<T> = await import(/* @vite-ignore */ spec).catch((cause: unknown) => {
		throw new Error(`P19 missing module ${path} (${String(cause)})`);
	});
	for (const name of names)
		if (mod[name] === undefined) throw new Error(`P19 missing export ${String(name)} from ${path}`);
	return mod as T;
};
const bridge = () =>
	load<typeof Bridge>("./bridge.ts", "desktop/bridge.ts", [
		"HelloRequest",
		"BridgeReply",
		"checkWindowRequest",
		"bridgeClientKey",
		"WindowBridge",
	]);
const clientKey = () =>
	load<typeof import("../client/key.ts")>("../client/key.ts", "client/key.ts (upstream P14)", [
		"ClientKey",
	]);
const RUNS = {seed: SEED, numRuns: 300};

const url = fc.constantFrom(
	"http://127.0.0.1:4387/electron",
	"http://127.0.0.1:4388/electron",
	"http://localhost:4387/electron",
	"https://fabrika.example/electron",
);
const binding = fc.record({
	frame: fc.uuid(),
	window: fc.integer({min: 1, max: 50}),
	url,
	tab: typeIdArb("tab"),
});
type Binding = typeof binding extends fc.Arbitrary<infer A> ? A : never;
const mismatch = fc.constantFrom("none", "frame", "top", "window", "tab");

describe("P19 bridge: what a window may ask", () => {
	it("plant, let a SchemaError escape or catch a throw as success: any request decodes to a HelloRequest or a typed refusal", async () => {
		const b = await bridge();
		fc.assert(
			fc.property(fc.jsonValue(), binding, (request, bound) => {
				const sender = {frame: bound.frame, top: bound.url, window: bound.window};
				const exit = Effect.runSyncExit(b.checkWindowRequest(request, sender, bound));
				expect(Exit.hasDies(exit)).toBe(false);
				if (Exit.isFailure(exit)) expect(JSON.stringify(exit)).toContain("DesktopDown");
			}),
			RUNS,
		);
	});

	it("plant, trust the page URL or accept a child frame or another window: a request passes only from the bound top frame, window, URL and tab", async () => {
		const b = await bridge();
		fc.assert(
			fc.property(
				binding,
				mismatch,
				fc.string({minLength: 1, maxLength: 40}),
				fc.uuid(),
				typeIdArb("tab"),
				url,
				(bound: Binding, off, nonce, otherFrame, otherTab, otherUrl) => {
					const sender = {
						frame: off === "frame" ? otherFrame : bound.frame,
						top: off === "top" ? (otherUrl === bound.url ? `${bound.url}#x` : otherUrl) : bound.url,
						window: off === "window" ? bound.window + 1 : bound.window,
					};
					const tab =
						off === "tab" ? (otherTab === bound.tab ? `${bound.tab}x` : otherTab) : bound.tab;
					const exit = Effect.runSyncExit(b.checkWindowRequest({nonce, tab}, sender, bound));
					expect(Exit.hasDies(exit)).toBe(false);
					if (off === "none") {
						expect(Exit.isSuccess(exit)).toBe(true);
						if (Exit.isSuccess(exit)) expect(exit.value).toEqual({nonce, tab: bound.tab});
					} else expect(Exit.isFailure(exit), `${off} differs`).toBe(true);
				},
			),
			{
				...RUNS,
				examples: [
					[
						{
							frame: "f",
							window: 1,
							url: "http://127.0.0.1:4387/electron",
							tab: "tab_01m6v5270hf3c8x2q7w9z4k5mn",
						},
						"top",
						"n",
						"g",
						"tab_01m6v5270hf3c8x2q7w9z4k5mp",
						"http://127.0.0.1:4387/electron",
					],
				],
			},
		);
	});
});

describe("P19 bridge: the renderer's ClientKey", () => {
	const identity = fc.record({
		key: windowKeyArb,
		fingerprint: fc
			.uint8Array({minLength: 32, maxLength: 32})
			.map((b) => `SHA256:${Buffer.from(b).toString("base64").replace(/=+$/, "")}`),
		tab: typeIdArb("tab"),
	});
	const reply = fc.oneof(
		identity.map((value) => ({_tag: "identity", value})),
		fc.string({minLength: 1}).map((value) => ({_tag: "signed", value})),
		fc.constant({_tag: "done"}),
		fc
			.constantFrom("bad_request", "bad_sender", "bad_key", "unavailable")
			.map((why) => ({_tag: "refused", why})),
		fc.jsonValue(),
	);

	it("plant, expose generic sign, export, a path or IPC: the ClientKey a page gets has only P14's five members, and every bridge reply is decoded", async () => {
		const b = await bridge();
		const {ClientKey} = await clientKey();
		await fc.assert(
			fc.asyncProperty(
				reply,
				reply,
				fc.string(),
				typeIdArb("tab"),
				async (forIdentity, forSign, nonce, tab) => {
					const asked: Array<unknown> = [];
					const impl = {
						identity: Effect.sync(() => {
							asked.push({op: "identity"});
							return forIdentity;
						}),
						sign: (request: unknown) =>
							Effect.sync(() => {
								asked.push({op: "sign", request});
								return forSign;
							}),
						replace: Effect.sync(() => {
							asked.push({op: "replace"});
							return forIdentity;
						}),
						changes: Stream.make(forIdentity),
						persist: Effect.sync(() => {
							asked.push({op: "persist"});
							return {_tag: "done"};
						}),
					};
					const layer = b.bridgeClientKey.pipe(
						Layer.provide(
							Layer.succeed(b.WindowBridge, impl as Context.Service.Shape<typeof b.WindowBridge>),
						),
					);
					await Effect.runPromise(
						Effect.gen(function* () {
							const key = yield* ClientKey;
							expect(Object.keys(key).sort()).toEqual([
								"changes",
								"identity",
								"persist",
								"replace",
								"sign",
							]);
							const got = yield* Effect.exit(key.identity);
							const signed = yield* Effect.exit(
								key.sign({nonce, url: "http://evil.example/", tab}),
							);
							for (const exit of [got, signed]) expect(Exit.hasDies(exit)).toBe(false);
							const okIdentity =
								typeof forIdentity === "object" &&
								forIdentity !== null &&
								"_tag" in forIdentity &&
								forIdentity._tag === "identity";
							expect(Exit.isSuccess(got)).toBe(okIdentity);
							if (Exit.isFailure(got)) expect(JSON.stringify(got)).toContain("KeyDown");
							const okSign =
								typeof forSign === "object" &&
								forSign !== null &&
								"_tag" in forSign &&
								forSign._tag === "signed";
							expect(Exit.isSuccess(signed)).toBe(okSign);
							// The page's URL never reaches the bridge: main binds the URL itself.
							const sent = asked.filter((a) => (a as {op: string}).op === "sign");
							for (const s of sent) expect(JSON.stringify(s)).not.toContain("evil.example");
						}).pipe(Effect.provide(layer)),
					);
				},
			),
			{seed: SEED, numRuns: 200},
		);
	});
});
