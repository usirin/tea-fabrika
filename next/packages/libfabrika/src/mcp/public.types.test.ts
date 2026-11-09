// P25 public imports, next/. This file deliberately imports only the library's public names.
import {expect, it} from "@effect/vitest";
import {Id, Input, Program} from "@kampus/libfabrika";
import type {BridgeDown} from "@kampus/libfabrika/client";
import {startClient, type HeadlessClient} from "@kampus/libfabrika/client";
import {
	listTools,
	readCall,
	driveFor,
	serveBridge,
	CallStore,
	CallReceipt,
	type Drive,
	type McpReply,
} from "@kampus/libfabrika/mcp";
import type {Effect, Redacted, Schema} from "effect";
import {expectTypeOf} from "vitest";
import type {readAgentKeyFile} from "../node/agent-key.ts";

it("L27 public client operations come from libfabrika alone", () => {
	expect(typeof startClient).toBe("function");
	expect(typeof driveFor).toBe("function");
	expect(typeof serveBridge).toBe("function");
	expectTypeOf<Drive["call"]>().returns.toExtend<Effect.Effect<McpReply, BridgeDown>>();
	expectTypeOf<HeadlessClient["ps"]>().toExtend<Effect.Effect<Schema.Json, BridgeDown>>();
});
// Uncalled. The valid declarations and invalid neighbors must both compile as intended.
function publicTypes(client: HeadlessClient, drive: Drive, secret: Redacted.Redacted<Uint8Array>) {
	const process = Id.Process.make("process_0000000000e008000000000000");
	expectTypeOf(client.open(process)).toExtend<Effect.Effect<unknown, BridgeDown>>();
	expectTypeOf(secret).toEqualTypeOf<Redacted.Redacted<Uint8Array>>();
	expectTypeOf<Effect.Success<ReturnType<typeof readAgentKeyFile>>>().toEqualTypeOf<
		Redacted.Redacted<Uint8Array>
	>();
	// @ts-expect-error A private key read is wrapped, never naked bytes.
	const bytes: Uint8Array = secret;
	// @ts-expect-error The client requires a checked process ID.
	client.open("process_0000000000e008000000000000");
	expectTypeOf(listTools).toBeFunction();
	expectTypeOf(readCall).toBeFunction();
	expectTypeOf(CallStore).toBeFunction();
	expectTypeOf(CallReceipt).toBeObject();
	void [drive, bytes, Input, Program];
}
void publicTypes;
