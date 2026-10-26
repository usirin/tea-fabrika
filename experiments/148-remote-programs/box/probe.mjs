// Experiment 148's probe: run as root in the box (ProjectHost.probe, by exec). Is there a key, the
// seal, or a sign-in anywhere in the box? It is handed none of them: it looks for their shapes,
// which the driver makes every made-up secret in, and answers counts and places, never a match.
//
//   fake-key-<32 hex>   a person's model key       never in the box
//   seal-<32 hex>       the Worker's sealing secret never in the box
//   sess-<32 hex>       a person's sign-in session never in the box
//
// It reads every process's environment, command line and memory (/proc/<pid>/mem, region by
// region, as maps lists them), and every file but /proc, /sys and /dev.
import {closeSync, openSync, readdirSync, readFileSync, readSync, statSync} from "node:fs";
import {join} from "node:path";

const SHAPES = {
	key: /fake-key-[0-9a-f]{32}/g,
	seal: /seal-[0-9a-f]{32}/g,
	session: /sess-[0-9a-f]{32}/g,
};

const found = {key: [], seal: [], session: []};
const looked = {
	user: process.getuid?.(),
	env: 0,
	cmdline: 0,
	memBytes: 0,
	procRefused: [],
	memRefused: [],
	files: 0,
	fileBytes: 0,
};

const scan = (where, text) => {
	for (const [name, shape] of Object.entries(SHAPES)) {
		const n = (text.match(shape) ?? []).length;
		if (n > 0) found[name].push({where, n});
	}
};

const pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d) && d !== String(process.pid));
for (const pid of pids) {
	let name = "?";
	try {
		name = readFileSync(`/proc/${pid}/comm`, "latin1").trim();
		scan(`/proc/${pid}(${name})/environ`, readFileSync(`/proc/${pid}/environ`, "latin1"));
		looked.env++;
		scan(`/proc/${pid}(${name})/cmdline`, readFileSync(`/proc/${pid}/cmdline`, "latin1"));
		looked.cmdline++;
	} catch (e) {
		looked.procRefused.push(`${pid}(${name}): ${e.code ?? e.message}`);
		continue;
	}
	// Its memory: every readable region. A secret cut in two at a chunk's edge is caught by the overlap.
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
		looked.memRefused.push(`${pid}(${name}): ${e.code ?? e.message}`);
	}
}

// Every file, but the kernel's own trees.
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
				scan(p, readFileSync(p, "latin1"));
				looked.files++;
				looked.fileBytes += st.size;
			} catch {
				// unreadable: a socket or the like
			}
		}
	}
};
walk("/");

// Its own environment last: the one exec was started with.
scan("probe's own env", Object.entries(process.env).join("\n"));

process.stdout.write(JSON.stringify({found, looked, processes: pids.length}));
