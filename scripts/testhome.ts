import { mkdtempSync } from "node:fs";
import { join } from "node:path";

// Today's tooling: fresh homes, with mkdtemp's suffix included in the socket limit.
export const testHomes = (env: NodeJS.ProcessEnv, temp: string): void => {
  const root = Buffer.byteLength(join(temp, "fh-XXXXXX", "host", "sock")) < 103 ? temp : "/tmp";
  env.FABRIKA_HOME = mkdtempSync(join(root, "fh-"));
  env.HOME = mkdtempSync(join(root, "hh-"));

  for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) {
    delete env[key];
  }
};
