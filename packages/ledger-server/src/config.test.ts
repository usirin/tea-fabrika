import {ledgerBindings} from "@kampus/fabrika-old/local";
import {describe, expect, it} from "vitest";
import {decodeConfig, serverDoor} from "./config.ts";

describe("a ledger server's config", () => {
	it("gives the bindings the deploy and the twin both use", () => {
		const config = decodeConfig({name: "acme-ledger", founder: "github:7"});
		expect(ledgerBindings({door: serverDoor(config)})).toEqual({
			EXPIRY_GRACE_MS: "1000",
			DOOR: "shared",
			FOUNDER: "github:7",
			KEYS: "github",
		});
	});

	it("refuses a name Cloudflare would not take, or a founder that is no GitHub id", () => {
		expect(() => decodeConfig({name: "Acme Ledger", founder: "github:7"})).toThrow();
		expect(() => decodeConfig({name: "acme-ledger", founder: "alice"})).toThrow();
		expect(() => decodeConfig({name: "acme-ledger", founder: "github:07"})).toThrow();
		expect(() =>
			decodeConfig({name: "acme-ledger", founder: "github:7", origin: "https://a.example.com/x"}),
		).toThrow();
	});
});
