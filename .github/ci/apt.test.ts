import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
// Declared so vitest's `--changed` walk reaches this test when the script changes.
import "./apt.sh?raw";

// Today's CI. Covers apt.sh, the apt step of the test job and of next's chromium step. No root
// and no network: a fake `apt-get` fails while the Azure mirror is listed, for the verbs a case
// names, and a fake `timeout` runs its command at once.
const script = new URL("./apt.sh", import.meta.url).pathname;

// Ubuntu 24.04's stock deb822 file and the image's mirror list (actions/runner-images,
// configure-apt-sources.sh), and 22.04's one-line format.
const mirrors =
  "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n" +
  "https://archive.ubuntu.com/ubuntu/\tpriority:2\n" +
  "https://security.ubuntu.com/ubuntu/\tpriority:3\n";

const deb822 = [
  "Types: deb",
  "URIs: http://azure.archive.ubuntu.com/ubuntu/",
  "Suites: noble noble-updates noble-backports",
  "Components: main universe restricted multiverse",
  "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg",
  "",
  "Types: deb",
  "URIs: http://security.ubuntu.com/ubuntu/",
  "Suites: noble-security",
  "Components: main universe restricted multiverse",
  "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg",
  "",
].join("\n");

const oneLine =
  "deb http://azure.archive.ubuntu.com/ubuntu/ jammy main restricted\n" +
  "deb http://azure.archive.ubuntu.com/ubuntu/ jammy-updates main restricted\n" +
  "deb http://security.ubuntu.com/ubuntu jammy-security main restricted\n";

const fakeAptGet = `#!/bin/sh
echo "$*" >>"$LOG"
case " $DEAD " in *" all "*) exit 100 ;; esac
if grep -qs azure "$APT_ETC/apt-mirrors.txt" "$APT_ETC/sources.list.d/ubuntu.sources" "$APT_ETC/sources.list"; then
  case " $DEAD " in *" $1 "*) exit 100 ;; esac
fi
exit 0
`;

const fakeTimeout = `#!/bin/sh
shift 2
exec "$@"
`;

type Files = Partial<Record<"apt-mirrors.txt" | "sources.list.d/ubuntu.sources" | "sources.list", string>>;

const box = (files: Files) => {
  const root = mkdtempSync(join(tmpdir(), "apt-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const etc = join(root, "etc"),
    bin = join(root, "bin");
  mkdirSync(join(etc, "sources.list.d"), { recursive: true });
  mkdirSync(bin);

  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(etc, name), text);
  }

  for (const [name, text] of [
    ["apt-get", fakeAptGet],
    ["timeout", fakeTimeout],
  ] as const) {
    writeFileSync(join(bin, name), text);
    chmodSync(join(bin, name), 0o755);
  }

  const log = join(root, "log");
  writeFileSync(log, "");
  const run = (args: string[], dead: string[] = []) =>
    spawnSync("sh", [script, ...args], {
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env["PATH"]}`, APT_ETC: etc, LOG: log, DEAD: dead.join(" ") },
    });
  const read = (name: keyof Files) => readFileSync(join(etc, name), "utf8");
  const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { run, read, calls };
};

// The image points its main stanza at the mirror list and leaves security as it is.
const imageSources = deb822.replace("http://azure.archive.ubuntu.com/ubuntu/", "mirror+file:/etc/apt/apt-mirrors.txt");
const image = { "apt-mirrors.txt": mirrors, "sources.list.d/ubuntu.sources": imageSources };
const install = ["install", "expect", "zsh"];
const installCall = "install -y --no-install-recommends expect zsh";

it("scenario: mirror fine, one try and no file changes", () => {
  const apt = box(image);
  const result = apt.run(install);
  expect(result.status).toBe(0);
  expect(apt.calls()).toEqual(["update", installCall]);
  expect(apt.read("apt-mirrors.txt")).toBe(mirrors);
  expect(result.stdout).not.toContain("::warning::");
});

it("scenario: mirror dead on update, Azure leaves the list and try 2 passes", () => {
  const apt = box(image);
  const result = apt.run(install, ["update"]);
  expect(result.status).toBe(0);
  expect(apt.calls()).toEqual(["update", "update", installCall]);
  expect(apt.read("apt-mirrors.txt")).toBe(mirrors.split("\n").slice(1).join("\n"));
  expect(result.stdout).toContain("::warning::apt-get install failed or passed its limit, try 1 of 3; dropping Azure");
});

it("scenario: mirror dead on install only, the retry refreshes the lists before it installs", () => {
  const apt = box(image);
  const result = apt.run(install, ["install"]);
  expect(result.status).toBe(0);
  expect(apt.calls()).toEqual(["update", installCall, "update", installCall]);
});

it("scenario: update alone, as next's chromium step runs it, falls back the same way", () => {
  const apt = box(image);
  expect(apt.run(["update"], ["update"]).status).toBe(0);
  expect(apt.calls()).toEqual(["update", "update"]);
  expect(apt.read("apt-mirrors.txt")).not.toContain("azure");
});

it("scenario: both mirrors dead, three tries, an error line and exit 1", () => {
  const apt = box(image);
  const result = apt.run(install, ["all"]);
  expect(result.status).toBe(1);
  expect(apt.calls()).toEqual(["update", "update", "update"]);
  expect(result.stdout).toContain("::error::apt-get install failed on every mirror, 3 tries");
});

it("scenario: no mirror list, deb822 sources point at archive.ubuntu.com after the fallback", () => {
  const apt = box({ "sources.list.d/ubuntu.sources": deb822 });
  expect(apt.run(["update"], ["update"]).status).toBe(0);
  expect(apt.read("sources.list.d/ubuntu.sources")).toBe(
    deb822.replace("http://azure.archive.ubuntu.com/ubuntu/", "http://archive.ubuntu.com/ubuntu/"),
  );
});

it("scenario: no mirror list, one-line sources.list points at archive.ubuntu.com after the fallback", () => {
  const apt = box({ "sources.list": oneLine });
  expect(apt.run(["update"], ["update"]).status).toBe(0);
  expect(apt.read("sources.list")).toBe(oneLine.replaceAll("azure.archive", "archive"));
  expect(apt.read("sources.list")).toContain("http://security.ubuntu.com/ubuntu jammy-security");
});

it("scenario: no mirror list and no sources file, a warning and the tries go on", () => {
  const apt = box({});
  const result = apt.run(["fallback"]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("::warning::no apt mirror list or Ubuntu sources");
});

it("scenario: fallback twice changes nothing the second time", () => {
  const apt = box(image);
  apt.run(["fallback"]);
  const once = [apt.read("apt-mirrors.txt"), apt.read("sources.list.d/ubuntu.sources")];
  apt.run(["fallback"]);
  expect([apt.read("apt-mirrors.txt"), apt.read("sources.list.d/ubuntu.sources")]).toEqual(once);
  // The image's sources read the list, so the fallback leaves them as they are.
  expect(once[1]).toBe(imageSources);
});

it.each([[[]], [["update", "zsh"]], [["install"]], [["upgrade"]]])("format: bad arguments exit 2: %j", (args) => {
  const apt = box(image);
  expect(apt.run(args).status).toBe(2);
  expect(apt.calls()).toEqual([]);
});
