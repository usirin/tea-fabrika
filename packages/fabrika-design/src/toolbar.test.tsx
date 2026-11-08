import {existsSync} from "node:fs";
import {createElement, type ComponentType} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";

type CommandRow = {
	id: string;
	name: string;
	keys: readonly string[];
	send: {type: string; value: unknown};
};

describe("today's shared command toolbar", () => {
	it("I17: accessible buttons use the prepared action and its live key", async () => {
		const path = "./toolbar.tsx";
		expect(
			existsSync(new URL(path, import.meta.url)),
			"I17: no shared toolbar draws program commands",
		).toBe(true);
		const module = await import(path);
		const Toolbar: ComponentType<{
			commands: readonly CommandRow[];
			send: (value: unknown) => void;
		}> = Reflect.get(module, "Toolbar");
		expect(Toolbar, "I17: no stateless command toolbar").toBeDefined();
		const command = {
			id: "inbox.open",
			name: "Open all",
			keys: ["shift+i"],
			send: {type: "open", value: null},
		};
		const html = renderToStaticMarkup(
			createElement(Toolbar, {commands: [command], send: () => {}}),
		);
		expect(html).toContain("Open all");
		expect(html).toMatch(/aria-keyshortcuts="[^"]*[iI][^"]*"/);
		expect(html).not.toMatch(/aria-keyshortcuts="[^"]*[oO][^"]*"/);
		expect(html).toContain('type="button"');
		const unbound = renderToStaticMarkup(
			createElement(Toolbar, {commands: [{...command, keys: []}], send: () => {}}),
		);
		expect(unbound).toContain("Open all");
		expect(unbound).not.toContain("shift+i");
	});
});
