// P24, next/. The public cloud descriptor is checked before an atomic file replacement.
import {NodeServices} from "@effect/platform-node";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, FileSystem, Layer, Option, Schema} from "effect";
import {HttpClient, HttpClientResponse} from "effect/http";
import {LedgerName, runs} from "../build/p24.test-support.ts";

const url = Schema.Literals([
	"https://cloud.invalid",
	"http://127.0.0.1:3310",
	"http://localhost:3310",
	"http://[::1]:3310",
]);
const badUrl = Schema.Literals([
	"http://public.invalid",
	"ftp://cloud.invalid",
	"file:///tmp/cloud",
	"ws://cloud.invalid",
	"https://person:secret@cloud.invalid",
	"https://cloud.invalid/?token=secret",
	"https://cloud.invalid/#pass",
	"https://cloud.invalid/?account=sentinel",
]);
const target = (before: string, after: string) => expect(after).toBe(before);
const client = (ledger: string, status = 200, malformed = false) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request) =>
			Effect.sync(() => {
				expect(request.method).toBe("GET");
				expect(new URL(request.url).pathname).toBe("/door");
				return HttpClientResponse.fromWeb(
					request,
					new Response(malformed ? "not json" : JSON.stringify({ledger}), {
						status,
						headers: {"content-type": "application/json"},
					}),
				);
			}),
		),
	);

describe("P24 cloud link", () => {
	it.effect.prop(
		"valid links check the exact door identity and leave stage.json alone",
		{url, ledger: LedgerName},
		({url, ledger}) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const home = yield* fs.makeTempDirectoryScoped({prefix: "p24-link-"});
				const active = '{"stage":"local"}';
				yield* fs.writeFileString(`${home}/stage.json`, active);
				const {installCloudLink, readCloudLink} = yield* Effect.promise(
					() => import("./cloud-link.ts"),
				);
				expect(
					yield* installCloudLink(home, {url, ledger}).pipe(Effect.provide(client(ledger))),
				).toEqual({url, ledger});
				expect(yield* readCloudLink(home)).toEqual(Option.some({url, ledger}));
				target(active, yield* fs.readFileString(`${home}/stage.json`));
			}).pipe(Effect.provide(NodeServices.layer)),
		runs,
	);
	it.effect.prop(
		"missing means none; malformed saved text fails without fallback",
		{text: Schema.String},
		({text}) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const home = yield* fs.makeTempDirectoryScoped({prefix: "p24-link-"});
				const {readCloudLink} = yield* Effect.promise(() => import("./cloud-link.ts"));
				expect(yield* readCloudLink(home)).toEqual(Option.none());
				yield* fs.writeFileString(`${home}/cloud.json`, JSON.stringify({url: text}));
				expect(Exit.isFailure(yield* Effect.exit(readCloudLink(home)))).toBe(true);
			}).pipe(Effect.provide(NodeServices.layer)),
		runs,
	);
	it.effect.prop(
		"credential URLs, remote plain HTTP, fragments and schemes are refused",
		{url: badUrl, ledger: LedgerName},
		({url, ledger}) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const home = yield* fs.makeTempDirectoryScoped({prefix: "p24-link-"});
				const old = JSON.stringify({url: "https://old.invalid", ledger});
				yield* fs.writeFileString(`${home}/cloud.json`, old);
				const {installCloudLink} = yield* Effect.promise(() => import("./cloud-link.ts"));
				expect(
					Exit.isFailure(
						yield* Effect.exit(
							installCloudLink(home, {url, ledger}).pipe(Effect.provide(client(ledger))),
						),
					),
				).toBe(true);
				target(old, yield* fs.readFileString(`${home}/cloud.json`));
			}).pipe(Effect.provide(NodeServices.layer)),
		runs,
	);
	it.effect.prop(
		"mismatched, malformed and failed door answers preserve the old target",
		{ledger: LedgerName, status: Schema.Literals([200, 403, 404, 500]), malformed: Schema.Boolean},
		({ledger, status, malformed}) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const home = yield* fs.makeTempDirectoryScoped({prefix: "p24-link-"});
				const old = JSON.stringify({url: "https://old.invalid", ledger});
				yield* fs.writeFileString(`${home}/cloud.json`, old);
				const {installCloudLink} = yield* Effect.promise(() => import("./cloud-link.ts"));
				const answer = yield* Effect.exit(
					installCloudLink(home, {url: "https://new.invalid", ledger}).pipe(
						Effect.provide(client(`${ledger}-other`, status, malformed)),
					),
				);
				expect(Exit.isFailure(answer)).toBe(true);
				target(old, yield* fs.readFileString(`${home}/cloud.json`));
			}).pipe(Effect.provide(NodeServices.layer)),
		runs,
	);
	it.effect.prop(
		"write or rename failure leaves the last good descriptor intact",
		{ledger: LedgerName, point: Schema.Literals(["write", "rename"])},
		({ledger, point}) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const home = yield* fs.makeTempDirectoryScoped({prefix: "p24-link-"});
				const old = JSON.stringify({url: "https://old.invalid", ledger});
				yield* fs.writeFileString(`${home}/cloud.json`, old);
				const failure = fs.rename("\0", "\0");
				const broken = Layer.succeed(FileSystem.FileSystem, {
					...fs,
					writeFileString: point === "write" ? () => failure : fs.writeFileString,
					rename: point === "rename" ? () => failure : fs.rename,
				});
				const {installCloudLink} = yield* Effect.promise(() => import("./cloud-link.ts"));
				expect(
					Exit.isFailure(
						yield* Effect.exit(
							installCloudLink(home, {url: "https://new.invalid", ledger}).pipe(
								Effect.provide(broken),
								Effect.provide(client(ledger)),
							),
						),
					),
				).toBe(true);
				target(old, yield* fs.readFileString(`${home}/cloud.json`));
			}).pipe(Effect.provide(NodeServices.layer)),
		runs,
	);
	it.prop(
		"plants: parse fallback, mismatched install and early replacement fail the same assertion",
		{ledger: LedgerName},
		({ledger}) => {
			const old = JSON.stringify({url: "https://old.invalid", ledger});
			for (const after of [
				"",
				JSON.stringify({url: "https://new.invalid", ledger: `${ledger}-other`}),
				JSON.stringify({url: "https://new.invalid", ledger}),
			])
				expect(() => target(old, after)).toThrow();
		},
		runs,
	);
});
