// Experiment 214's stand-in brain: the tiny Node script launchd runs. It writes its pid and a
// counter to the file it is given, twice a second, so the runner can see it is alive.
import {writeFileSync} from "node:fs";

const path = process.argv[2];
let beat = 0;
const write = () => {
	beat += 1;
	writeFileSync(path, JSON.stringify({pid: process.pid, beat}));
};
write();
setInterval(write, 500);
