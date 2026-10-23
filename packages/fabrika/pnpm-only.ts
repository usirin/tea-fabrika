// Refuses to pack or publish this package with anything but pnpm. In the repo, `exports` and `bin`
// name the `.ts` source; `publishConfig` names `dist/`, and only pnpm swaps it in when it packs.
// npm would pack the source names over a tarball that holds only `dist/`: every import broken.
// Run by `prepack` and `prepublishOnly`, which npm and pnpm both run first. Experiment 108.
// `@kampus/pipeline` runs this same file (experiment 114), so the package is named from the
// environment the package manager sets.
//
// Node at the edge: a package manager's lifecycle script.
const agent = process.env.npm_config_user_agent ?? "";
const name = process.env.npm_package_name ?? "This package";
if (!agent.startsWith("pnpm/")) {
	process.stderr.write(
		`${name} is packed and published with pnpm only (this is ${agent.split(" ")[0] || "an unknown tool"}): pnpm swaps in publishConfig's dist/ exports, npm does not. Run pnpm pack or pnpm publish.\n`,
	);
	process.exit(1);
}
