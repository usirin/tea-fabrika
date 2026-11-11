// A test names each script it runs with a `?raw` import, as `.agents/raw.d.ts` does, so Vitest's
// `--changed` picks the test when the script changes. The import is for its side effect.
declare module "*?raw" {
  const text: string;
  export default text;
}
