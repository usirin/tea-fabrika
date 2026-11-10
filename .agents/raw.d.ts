// A test names each script it reads as text with a `?raw` import (`script-reads` in `pnpm lint`), so
// Vitest's `--changed` picks the test when the script changes. The import is for its side effect.
declare module "*?raw" {
	const text: string;
	export default text;
}
