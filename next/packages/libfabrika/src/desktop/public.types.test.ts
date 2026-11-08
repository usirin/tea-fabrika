import type {IdGenerator, TabId} from "@kampus/libfabrika";
import type {
	BrainProbe,
	BrainService,
	DesktopDown,
	DesktopRecording,
	DesktopStore,
	Founding,
	KeyStore,
	LaunchControl,
	LaunchdSpec,
	PersonId,
	PersonKey,
	Seal,
	WindowBridge,
} from "@kampus/libfabrika/desktop";
import type {
	bridgeClientKey,
	launchdBrain,
	sealedClientKey,
	sealedPersonKey,
} from "@kampus/libfabrika/desktop";
import type {electronSeal} from "@kampus/libfabrika/electron";
import type {fileDesktopStore} from "@kampus/libfabrika/node/desktop-store";
import type {launchControl} from "@kampus/libfabrika/node/launchd";
import type {Context, Effect, FileSystem, Layer, Path, Schedule} from "effect";
import type {ChildProcessSpawner} from "effect/process";
// P19, next/. Type laws, checked by `pnpm typecheck` (plan "Laws", the Type rows): ID brands do not
// stand in for one another, the renderer's key contract has no private-key, arbitrary-signing,
// file or IPC member, and a client typed against libfabrika's public desktop exports alone compiles.
// Until the build lands, `pnpm typecheck` fails here on the missing modules; the runtime half below
// only holds the file to vitest.
import {describe, expectTypeOf, it} from "vitest";
import type {ClientKey} from "../client/key.ts";

type Person = typeof PersonId.Type;
type Tab = typeof TabId.Type;

describe("P19 type laws", () => {
	it("plant, accept a tab or a fingerprint where a PersonId belongs: the brands stay apart", () => {
		expectTypeOf<Person>().not.toEqualTypeOf<Tab>();
		expectTypeOf<Tab>().not.toMatchTypeOf<Person>();
		expectTypeOf<string>().not.toMatchTypeOf<Person>();
		expectTypeOf<(typeof Founding.Type)["person"]>().toEqualTypeOf<Person>();
		const takes = (_: Person) => undefined;
		// @ts-expect-error a key fingerprint is a string, never a PersonId
		takes("SHA256:abc");
	});

	it("plant, add a private getter, an arbitrary-byte signer, a path or raw IPC: the renderer's key has only P14's five members", () => {
		type Bridge = Context.Service.Shape<typeof WindowBridge>;
		type Key = Context.Service.Shape<typeof ClientKey>;
		expectTypeOf<keyof Bridge>().toEqualTypeOf<
			"identity" | "sign" | "replace" | "changes" | "persist"
		>();
		expectTypeOf<keyof Key>().toEqualTypeOf<
			"identity" | "sign" | "replace" | "changes" | "persist"
		>();
		expectTypeOf<Parameters<Bridge["sign"]>[0]>().not.toMatchTypeOf<Uint8Array>();
		expectTypeOf<Parameters<Key["sign"]>[0]>().toEqualTypeOf<{
			readonly nonce: string;
			readonly url: string;
			readonly tab: Tab;
		}>();
		expectTypeOf<typeof bridgeClientKey>().toEqualTypeOf<
			Layer.Layer<ClientKey, never, WindowBridge>
		>();
	});

	it("plant, require a Tuval or app helper: a client typed on public libfabrika exports alone composes", () => {
		expectTypeOf<ReturnType<typeof fileDesktopStore>>().toEqualTypeOf<
			Layer.Layer<
				DesktopStore | KeyStore,
				never,
				Seal | IdGenerator | FileSystem.FileSystem | Path.Path
			>
		>();
		expectTypeOf<typeof electronSeal>().toEqualTypeOf<Layer.Layer<Seal>>();
		expectTypeOf<typeof launchControl>().toEqualTypeOf<
			Layer.Layer<LaunchControl, never, ChildProcessSpawner.ChildProcessSpawner>
		>();
		expectTypeOf<typeof sealedPersonKey>().toEqualTypeOf<Layer.Layer<PersonKey, never, KeyStore>>();
		expectTypeOf<ReturnType<typeof sealedClientKey>>().toEqualTypeOf<
			Layer.Layer<ClientKey, never, KeyStore>
		>();
		expectTypeOf<ReturnType<typeof launchdBrain>>().toEqualTypeOf<
			Layer.Layer<BrainService, never, LaunchControl | BrainProbe | DesktopRecording>
		>();
		expectTypeOf<Parameters<typeof launchdBrain>>().toEqualTypeOf<
			[typeof LaunchdSpec.Type, {readonly poll: Schedule.Schedule<unknown>}]
		>();
		expectTypeOf<Context.Service.Shape<typeof BrainService>["up"]>().toEqualTypeOf<
			Effect.Effect<{readonly url: string}, DesktopDown>
		>();
	});
});
