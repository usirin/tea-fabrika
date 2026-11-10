// Today's tooling. Every test file gets fresh homes without reading inherited paths.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep the caller's temp root when host/sock fits, including mkdtemp's six-character suffix.
const temp = tmpdir();
const socket = join(temp, "fh-XXXXXX", "host", "sock");
const root = Buffer.byteLength(socket) < 103 ? temp : "/tmp";
process.env.FABRIKA_HOME = mkdtempSync(join(root, "fh-"));
process.env.HOME = mkdtempSync(join(root, "hh-"));

for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) {
  delete process.env[key];
}
