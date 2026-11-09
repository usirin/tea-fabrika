// Today's tooling. Tests never use the person's app data, including through a symlink.
import {lstatSync, mkdtempSync, readlinkSync, realpathSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {basename, dirname, join, resolve, sep} from "node:path";

function physical(path: string): string {
	try {
		return lstatSync(path).isSymbolicLink()
			? physical(resolve(dirname(path), readlinkSync(path)))
			: realpathSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return join(physical(dirname(path)), basename(path));
	}
}

function temporaryHome(): string {
	// Keep the caller's temp root when today's host/sock path fits, including mkdtemp's suffix.
	const temp = tmpdir();
	const socket = join(physical(temp), "fh-XXXXXX", "host", "sock");
	const root = Buffer.byteLength(socket) < 103 ? temp : "/tmp";
	return mkdtempSync(join(root, "fh-"));
}

const home = process.env.FABRIKA_HOME || temporaryHome();
const target = physical(resolve(home));
const real = physical(join(homedir(), ".fabrika"));
if (target === real || target.startsWith(`${real}${sep}`))
	throw new Error("FABRIKA_HOME must use a test folder outside the real app home");
process.env.FABRIKA_HOME = home;
