// P24, next/. Capture the app's real Alchemy declarations. Never invoke a live provider.
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {Effect, Schema} from "effect";
import {vi} from "vitest";
import {LedgerName, StageName} from "../build/p24.test-support.ts";

export const PublicSettings = Schema.Struct({
	stage: StageName,
	ledger: LedgerName,
	brain: Schema.Literal("brain.mjs"),
	build: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
	founder: Schema.Struct({
		person: Schema.String.check(
			Schema.isPattern(
				/^person_[0-7][0-9a-hjkmnp-tv-z]{9}[ef][0-9a-hjkmnp-tv-z]{2}[89abrstv][0-9a-hjkmnp-tv-z]{12}$/,
			),
		),
		name: Schema.NonEmptyString,
		// RFC 4253's public Ed25519 blob header plus 32 generated public bytes. No key file.
		key: Schema.String.check(
			Schema.isPattern(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-P][A-Za-z0-9+/]{42}$/),
		),
		window: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)),
	}),
});
export type Captured = {
	readonly type: string;
	readonly name: string;
	readonly props: any;
	readonly retained: boolean;
	readonly mode?: string;
};
const app = resolve(import.meta.dirname, "../../../../apps/fabrika");
const require = createRequire(resolve(app, "package.json"));

export const captureStack = Effect.fn("test.p24.captureStack")(function* (
	stage: typeof StageName.Type,
	settings: unknown,
) {
	process.env.DO_NOT_TRACK = "1";
	const capture: {
		resources: Record<string, any>;
		bindings: Record<string, any>;
		actions: Record<string, any>;
		name: string;
		stage: string;
	} = {
		resources: {},
		bindings: {},
		actions: {},
		name: "fabrika",
		stage,
	};
	// Only Stack's engine shell is replaced. Resource constructors and their retention decorators
	// are Alchemy's real code. No fake resource list can make a declaration test pass.
	const {StackContext} = yield* Effect.promise(
		() => import(pathToFileURL(require.resolve("alchemy/StackContext")).href),
	);
	yield* Effect.acquireRelease(
		Effect.sync(() => {
			vi.resetModules();
			vi.doMock(require.resolve("alchemy"), async () => {
				const real = await vi.importActual<any>(require.resolve("alchemy"));
				return {
					...real,
					Stack: (name: string, _options: unknown, body: Effect.Effect<unknown>) => {
						capture.name = name;
						return body.pipe(Effect.provideService(StackContext, capture));
					},
				};
			});
		}),
		() =>
			Effect.sync(() => {
				vi.doUnmock(require.resolve("alchemy"));
				vi.resetModules();
			}),
	);
	const {stack} = yield* Effect.promise(
		() => import(pathToFileURL(resolve(app, "alchemy.run.ts")).href),
	);
	yield* stack({brain: "brain.mjs"}, settings);
	const resources: readonly Captured[] = Object.values(capture.resources).map((r) => ({
		type: r.Type,
		name: r.LogicalId,
		props: r.Props,
		retained: r.RemovalPolicy === "retain",
		mode: r.Mode,
	}));
	return {resources, name: capture.name};
});
