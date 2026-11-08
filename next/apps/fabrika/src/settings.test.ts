import {Schema} from "effect";
import {expect, it} from "vitest";

it("local settings accept both port boundaries and reject ports outside them", async () => {
	const {Settings} = await import("./settings.ts");
	const settings = {name: "local", person: "person", founder: "public", window: null, build: "a"};
	for (const port of [1, 65535])
		expect(Schema.decodeUnknownSync(Settings)({...settings, port}).port).toBe(port);
	for (const port of [0, 65536]) expect(Schema.is(Settings)({...settings, port})).toBe(false);
});
