// Today's app, T343/T22. Follow aliases before deciding whether a color may draw words.
import {readFileSync, readdirSync} from "node:fs";
import {parse} from "smol-toml";
import {generated, plugin, references, TOKENS} from "../css-support.ts";

const folder = new URL("../../packages/fabrika-design/tokens/color/", import.meta.url);
const roles = new Map<string, {readonly type: unknown; readonly extends: string | undefined}>(
	readdirSync(folder)
		.filter((name) => name.endsWith(".toml"))
		.map((name) => {
			const token = parse(readFileSync(new URL(name, folder), "utf8"));
			const colors = token["colors"] as Record<string, unknown>;
			return [
				`--${name.slice(0, -5)}`,
				{
					type: token["type"],
					extends: typeof colors["extends"] === "string" ? `--${colors["extends"]}` : undefined,
				},
			] as const;
		}),
);
const role = (name: string): unknown => {
	const seen = new Set<string>();
	let at: string | undefined = name;
	while (at !== undefined && !seen.has(at)) {
		seen.add(at);
		const value = roles.get(at);
		if (value?.extends === undefined) return value?.type;
		at = value.extends;
	}
	return undefined;
};
const textProperty = /^(?:color|(?:-webkit-)?text-(?:fill|stroke)-color)$/;
const mantiText = /^--manti-(?:text(?:-.+)?|link|danger-text|warning-text|selection-text)$/;
export default plugin("text-token", (root, fire) => {
	// A custom property's value depends on which rule and media query reach an element, which a
	// stylesheet alone cannot tell. So an alias may be any value it is given anywhere, in any
	// selector or media block: one text value elsewhere never hides a border value (T343 review 2).
	const aliases = new Map<string, Set<string>>();
	const alias = (key: string, values: readonly string[]) => {
		const known = aliases.get(key) ?? new Set<string>();
		for (const value of values) known.add(value);
		aliases.set(key, known);
	};
	// Manti is mapped in the shared stylesheet; check those aliases in consumers too.
	const css = readFileSync(new URL(`../../${TOKENS}`, import.meta.url), "utf8");
	for (const [, key = "", value = ""] of css.matchAll(/(--[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\)/g))
		alias(key, [value]);
	root.walkDecls((decl) => {
		if (decl.prop.startsWith("--")) alias(decl.prop, references(decl));
	});
	root.walkDecls((decl) => {
		if (generated(decl) || (!textProperty.test(decl.prop) && !mantiText.test(decl.prop))) return;
		const pending = [...references(decl)],
			seen = new Set<string>();
		while (pending.length > 0) {
			const name = pending.pop();
			if (name === undefined) break;
			if (seen.has(name)) continue;
			seen.add(name);
			const type = role(name);
			if (type !== undefined && type !== "text")
				fire(decl, `${name} is ${type}; words need a text token`);
			pending.push(...(aliases.get(name) ?? []));
		}
	});
});
