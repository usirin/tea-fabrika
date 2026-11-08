import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {expect} from "vitest";

// A planned product entry point must exist before it is loaded. Import errors from an existing
// file are never swallowed; a missing feature fails inside its law rather than at collection.
export const product = async (path: string, law: string, missing: string) => {
	const url = new URL(`../../${path}`, import.meta.url);
	expect(existsSync(fileURLToPath(url)), `${law}: ${missing}`).toBe(true);
	return import(/* @vite-ignore */ fileURLToPath(url));
};
export const member = <A>(module: object, name: string, why: string): A => {
	const value = Reflect.get(module, name);
	expect(value, why).toBeDefined();
	return value;
};
