import {jevQuestions} from "@demlik/tea/jev";
import {ConfigProvider, Effect, Exit, Layer, Redacted} from "effect";
import {FetchHttpClient} from "effect/http";
import {describe, expect, it} from "vitest";
import {JevReceipts, jevFromConfig, liveJev, receiptLine, USD_PER_TOKEN} from "./jev-live.ts";
import {Jev} from "./services.ts";

// The live Jev against a fake fetch: no call leaves the test. What it sends, the receipt it keeps
// per call, the cap that refuses a call before it is sent, and a missing key that stops it
// building at all.

const questions = jevQuestions({answer: {type: "noul", instructions: "Is it so?"}});
const request = {state: {text: "a"}, model: "jev-latest", questions};

const fake = (
	reply: () => Response = () =>
		Response.json({
			model: "jev-latest",
			answers: {answer: {type: "noul", noul: 0.9}},
			usage: {input_tokens: 1000, output_tokens: 2},
		}),
) => {
	const sent: {readonly url: string; readonly auth: string | null; readonly body: string}[] = [];
	const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const req = new Request(input, init);
		sent.push({url: req.url, auth: req.headers.get("authorization"), body: await req.text()});
		return reply();
	};
	const http = Layer.provide(
		FetchHttpClient.layer,
		Layer.succeed(FetchHttpClient.Fetch, fetch as typeof globalThis.fetch),
	);
	return {sent, http};
};

const key = Redacted.make("not-a-key");

const calls = (n: number) =>
	Effect.gen(function* () {
		const jev = yield* Jev;
		const exits = [];
		for (let i = 0; i < n; i++) exits.push(yield* Effect.exit(jev.call(request)));
		return {exits, spent: yield* (yield* JevReceipts).spent};
	});

describe("the live Jev", () => {
	it("sends the request with the key as a bearer token, and keeps a receipt per call", async () => {
		const {sent, http} = fake();
		const {exits, spent} = await Effect.runPromise(
			calls(2).pipe(Effect.provide(Layer.provide(liveJev(key, {calls: 10, usd: 1}), http))),
		);
		expect(exits.map(Exit.isSuccess)).toEqual([true, true]);
		expect(sent.map((s) => [s.url, s.auth])).toEqual([
			["https://api.typesafe.ai/v1/systemone", "Bearer not-a-key"],
			["https://api.typesafe.ai/v1/systemone", "Bearer not-a-key"],
		]);
		expect(JSON.parse(sent[0]?.body ?? "")).toEqual(request);
		expect(spent).toMatchObject({calls: 2, input: 2000, output: 4});
		expect(spent.usd).toBeCloseTo(2004 * USD_PER_TOKEN, 12);
		expect(receiptLine(spent)).toMatch(
			/^jev: 2 calls, 2000 input and 4 output tokens, \$0\.0001, \d+ ms a call$/,
		);
	});

	it("refuses a call past the cap before sending it", async () => {
		const {sent, http} = fake();
		const {exits} = await Effect.runPromise(
			calls(3).pipe(Effect.provide(Layer.provide(liveJev(key, {calls: 2, usd: 1}), http))),
		);
		expect(exits.map(Exit.isSuccess)).toEqual([true, true, false]);
		expect(sent).toHaveLength(2);
		const third = exits[2];
		const cause = third !== undefined && Exit.isFailure(third) ? JSON.stringify(third.cause) : "";
		expect(cause).toContain("over_cap");
	});

	it("stops at the dollar cap too, counted from the tokens each reply says", async () => {
		const {sent, http} = fake();
		// One call is 1,002 tokens, about $0.000042: a cap of $0.00005 lets one through.
		const {exits} = await Effect.runPromise(
			calls(3).pipe(Effect.provide(Layer.provide(liveJev(key, {calls: 100, usd: 0.00005}), http))),
		);
		expect(exits.map(Exit.isSuccess)).toEqual([true, true, false]);
		expect(sent).toHaveLength(2);
	});

	it("hands a refusal back as the reply, with its status, and keeps its receipt", async () => {
		const {http} = fake(() => Response.json({error: "busy"}, {status: 429}));
		const {exits, spent} = await Effect.runPromise(
			calls(1).pipe(Effect.provide(Layer.provide(liveJev(key, {calls: 10, usd: 1}), http))),
		);
		const [first] = exits;
		expect(first !== undefined && Exit.isSuccess(first) ? first.value.status : null).toBe(429);
		expect(spent).toMatchObject({calls: 1, input: 0, output: 0, usd: 0});
	});

	it("with no key set it does not build, and sends nothing", async () => {
		const {sent, http} = fake();
		const exit = await Effect.runPromiseExit(
			calls(1).pipe(
				Effect.provide(Layer.provide(jevFromConfig({calls: 10, usd: 1}), http)),
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
			),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		expect(JSON.stringify(exit)).toContain("TYPESAFE_API_KEY");
		expect(sent).toHaveLength(0);
	});

	it("never shows the key in a receipt", async () => {
		const {http} = fake();
		const receipts = await Effect.runPromise(
			Effect.gen(function* () {
				yield* (yield* Jev).call(request);
				return yield* (yield* JevReceipts).receipts;
			}).pipe(Effect.provide(Layer.provide(liveJev(key, {calls: 10, usd: 1}), http))),
		);
		expect(JSON.stringify(receipts)).not.toContain("not-a-key");
	});
});
