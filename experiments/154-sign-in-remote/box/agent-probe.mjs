// Experiment 154's agent probe: what an agent's command inside the box could read. It is handed
// no secret; it looks for the fake sign-in's shapes and answers counts and places, never a match.
//
//   fake_at_<48 hex>    a pass (access token)
//   fake_rt_<48 hex>    a refresh token
//   fake_code_<32 hex>  a sign-in code
//
// It reads its own environment; every process's environment, command line and memory it may
// (/proc on Linux, `ps eww` on a Mac); and every file under the folders it can reach: on Linux
// all of /, on a Mac the folder above its own (the run's folder: the box's, the app's, the
// ledger's files). Node only: this runs as the agent would, with nothing of ours.
import {execFileSync} from "node:child_process";
import {
	closeSync,
	existsSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	statSync,
} from "node:fs";
import {dirname, join, relative} from "node:path";

const SHAPES = {
	access: /fake_at_[0-9a-f]{48}/g,
	refresh: /fake_rt_[0-9a-f]{48}/g,
	code: /fake_code_[0-9a-f]{32}/g,
};
const found = {access: [], refresh: [], code: []};
const looked = {user: process.getuid?.(), env: 0, procs: 0, memBytes: 0, refused: [], files: 0};
const scan = (where, text) => {
	for (const [name, shape] of Object.entries(SHAPES)) {
		const n = (text.match(shape) ?? []).length;
		if (n > 0) found[name].push({where, n});
	}
};

scan("own env", Object.entries(process.env).join("\n"));
looked.env++;

const linux = existsSync("/proc/self/maps");
if (linux) {
	for (const pid of readdirSync("/proc").filter(
		(d) => /^\d+$/.test(d) && d !== String(process.pid),
	)) {
		let name = "?";
		try {
			name = readFileSync(`/proc/${pid}/comm`, "latin1").trim();
			scan(`/proc/${pid}(${name})/environ`, readFileSync(`/proc/${pid}/environ`, "latin1"));
			scan(`/proc/${pid}(${name})/cmdline`, readFileSync(`/proc/${pid}/cmdline`, "latin1"));
			looked.procs++;
		} catch (e) {
			looked.refused.push(`${name} environ: ${e.code ?? e.message}`);
			continue;
		}
		try {
			const maps = readFileSync(`/proc/${pid}/maps`, "latin1").split("\n");
			const fd = openSync(`/proc/${pid}/mem`, "r");
			const buf = Buffer.alloc(1 << 20);
			for (const line of maps) {
				const m = line.match(/^([0-9a-f]+)-([0-9a-f]+) r/);
				if (m === null) continue;
				let at = BigInt(`0x${m[1]}`);
				const end = BigInt(`0x${m[2]}`);
				let carry = "";
				while (at < end) {
					const len = Number(end - at < BigInt(buf.length) ? end - at : BigInt(buf.length));
					let got = 0;
					try {
						got = readSync(fd, buf, 0, len, at);
					} catch {
						break;
					}
					if (got <= 0) break;
					const text = carry + buf.toString("latin1", 0, got);
					scan(`/proc/${pid}(${name})/mem`, text);
					carry = text.slice(-64);
					looked.memBytes += got;
					at += BigInt(got);
				}
			}
			closeSync(fd);
		} catch (e) {
			looked.refused.push(`${name} mem: ${e.code ?? e.message}`);
		}
	}
} else {
	// A Mac: the environment of every process of this user, as `ps` shows it.
	try {
		scan("ps -E", execFileSync("ps", ["-A", "-E", "-ww", "-o", "command"], {encoding: "latin1"}));
		looked.procs++;
	} catch (e) {
		looked.refused.push(`ps: ${e.message}`);
	}
	// Another process's memory on a Mac takes task_for_pid, which needs a debugger's rights: not tried.
	looked.refused.push("memory: not tried on a Mac");
}

const top = linux ? "/" : dirname(process.cwd());
const walk = (dir) => {
	let names = [];
	try {
		names = readdirSync(dir);
	} catch {
		return;
	}
	for (const n of names) {
		const p = join(dir, n);
		if (p === "/proc" || p === "/sys" || p === "/dev") continue;
		let st;
		try {
			st = statSync(p, {throwIfNoEntry: false});
		} catch {
			continue;
		}
		if (st === undefined) continue;
		if (st.isDirectory()) walk(p);
		else if (st.isFile() && st.size < 64 * 1024 * 1024) {
			try {
				// On a Mac the place is said from the run's folder: no machine path in the answer.
				scan(linux ? p : `run/${relative(top, p)}`, readFileSync(p, "latin1"));
				looked.files++;
			} catch {
				// unreadable to this user
			}
		}
	}
};
walk(top);

process.stdout.write(JSON.stringify({found, looked}));
