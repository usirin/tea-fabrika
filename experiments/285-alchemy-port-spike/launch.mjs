// Experiment 285, next/. Starts one script of this folder in a throwaway home.
//
// The scripts import Alchemy and libfabrika, which only `next/apps/fabrika/node_modules` holds. So
// this copies the folder to a temp home, links those packages beside it and imports the script
// from there, the way `next/apps/fabrika/src/sibling.laws.test.ts` runs its fixture. The home is
// removed at the end. Raw results go to `runs/285/`, which git ignores.
//
//   ( ulimit -u 2000; nice -n 19 volta run --node 26.13.0 \
//       node experiments/285-alchemy-port-spike/launch.mjs fetch )
import { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const here = import.meta.dirname;
const root = resolve(here, "../..");
const [script] = process.argv.slice(2);

if (script === undefined || !/^[a-z-]+$/.test(script)) {
  console.error("usage: launch.mjs <fetch|control|bundle|storage|timing|provider>");
  process.exit(2);
}

const home = realpathSync(mkdtempSync(join(tmpdir(), "s285-")));
cpSync(here, join(home, "src"), { recursive: true });
mkdirSync(join(home, "node_modules"));

// The app's packages, and React from libfabrika's, which the compiled `.tsx` of `bundle` imports.
for (const name of readdirSync(join(root, "next/apps/fabrika/node_modules"))) {
  symlinkSync(join(root, "next/apps/fabrika/node_modules", name), join(home, "node_modules", name));
}

symlinkSync(join(root, "next/packages/libfabrika/node_modules/react"), join(home, "node_modules/react"));
writeFileSync(join(home, "package.json"), JSON.stringify({ type: "module" }));
mkdirSync(join(root, "runs/285"), { recursive: true });

// Set before Alchemy loads: no telemetry, no key, and its own state folder.
process.env.DO_NOT_TRACK = "1";
process.env.ALCHEMY_HOME = join(home, "alchemy-home");
delete process.env.TYPESAFE_API_KEY;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.CLOUDFLARE_ACCOUNT_ID;
process.env.S285_HOME = home;
process.env.S285_ROOT = root;
process.env.S285_OUT = join(root, "runs/285");

let code = 0;

try {
  // Each script runs when it is imported, and ends when its runtime has stopped.
  await import(pathToFileURL(join(home, "src", `${script}.ts`)).href);
} catch (error) {
  console.error(error);
  code = 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}

// The runtime was stopped by its own scope inside the script. This only ends this Node process.
process.exit(code);
