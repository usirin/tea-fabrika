// A WebAssembly file, imported by the terminal's page: esbuild's `binary` loader puts its bytes
// in the bundle (build.ts), so the page compiles it without fetching anything.
declare module "*.wasm" {
	const bytes: Uint8Array<ArrayBuffer>;
	export default bytes;
}
