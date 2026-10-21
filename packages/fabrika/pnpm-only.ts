// Refuses to pack or publish this package with anything but pnpm. In the repo, `exports` and `bin`
// name the `.ts` source; `publishConfig` names `dist/`, and only pnpm swaps it in when it packs.
// npm would pack the source names over a tarball that holds only `dist/`: every import broken.
// Run by `prepack` and `prepublishOnly`, which npm and pnpm both run first. Experiment 108.
//
// Node at the edge: a package manager's lifecycle script.
const agent = process.env.npm_config_user_agent ?? "";
if (!agent.startsWith("pnpm/")) {
	process.stderr.write(
		`@kampus/fabrika is packed and published with pnpm only (this is ${agent.split(" ")[0] || "an unknown tool"}): pnpm swaps in publishConfig's dist/ exports, npm does not. Run pnpm pack or pnpm publish.\n`,
	);
	process.exit(1);
}
