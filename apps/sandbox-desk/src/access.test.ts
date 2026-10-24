import {describe, expect, it} from "vitest";
import {allowedRequest, configuration, forwarded} from "./access.ts";

const origin = "https://desk.example";
describe("the private desk boundary", () => {
	it("requires the same origin for commands and WebSocket upgrades", () => {
		for (const request of [
			new Request(`${origin}/fabrika/cloud/save`, {method: "POST"}),
			new Request(`${origin}/fabrika/cloud/save`, {
				method: "POST",
				headers: {origin: "https://other.example"},
			}),
			new Request(`${origin}/fabrika/ws`, {headers: {upgrade: "websocket"}}),
			new Request("https://other.example/fabrika/"),
			new Request(`${origin}/__host/status`),
		])
			expect(allowedRequest(request, origin)).toBe(false);
		expect(
			allowedRequest(
				new Request(`${origin}/fabrika/cloud/save`, {method: "POST", headers: {origin}}),
				origin,
			),
		).toBe(true);
	});
	it("strips identity and user-supplied routing credentials before reaching a desk", () => {
		const request = forwarded(
			new Request(`${origin}/fabrika/`, {
				headers: {
					cookie: "private",
					authorization: "private",
					"cf-access-jwt-assertion": "private",
					"x-fabrika-owner": "other",
					"x-fabrika-gateway": "forged",
					origin,
				},
			}),
		);
		expect([...request.headers]).toEqual([["origin", origin]]);
	});
	it("refuses an owner map that sends two people to the same disk", () => {
		expect(() =>
			configuration({
				FABRIKA_ORIGIN: origin,
				ACCESS_ISSUER: "https://access.example",
				ACCESS_AUD: "app",
				FABRIKA_OWNERS: JSON.stringify({
					"one@example.org": "a".repeat(32),
					"two@example.org": "a".repeat(32),
				}),
			}),
		).toThrow("distinct private desk IDs");
	});
});
