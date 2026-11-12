// A test that takes a file's text as a value, as `import entry from "./mutbox-entry.sh?raw"`. What a
// test's scripts read is derived (oxlint-plugins/script-reads.mjs), so no test imports one bare.
declare module "*?raw" {
  const text: string;
  export default text;
}
