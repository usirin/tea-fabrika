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

// Fails the verbs `DEAD` names while a host in `DOWN` is one this run would ask: each direct
// source, and the top of the mirror list for every `mirror+file:` source. `all` fails every call.
const fakeAptGet = String.raw`#!/bin/sh
echo "$*" >>"$LOG"
case " $DEAD " in *" all "*) exit 100 ;; esac
case " $DEAD " in *" $1 "*) ;; *) exit 0 ;; esac
top=$(head -n 1 "$APT_ETC/apt-mirrors.txt" 2>/dev/null | cut -f 1)
uris=$(cat "$APT_ETC/sources.list.d/ubuntu.sources" "$APT_ETC/sources.list" 2>/dev/null |
  grep -oE '(https?|mirror\+file):[^ ]*' || true)
for uri in $uris; do
  case $uri in mirror+file:*) uri=$top ;; esac
  host=$(echo "$uri" | sed -E 's#^[a-z]+://([^/]*).*#\1#')
  [ -n "$host" ] || exit 100
  case " $DOWN " in *" $host "*) exit 100 ;; esac
done
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
  const run = (args: string[], dead: string[] = [], down: string[] = [azure]) =>
    spawnSync("sh", [script, ...args], {
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env["PATH"]}`,
        APT_ETC: etc,
        LOG: log,
        DEAD: dead.join(" "),
        DOWN: down.join(" "),
      },
    });
  const read = (name: keyof Files) => readFileSync(join(etc, name), "utf8");
  const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const list = `mirror+file:${join(etc, "apt-mirrors.txt")}`;
  return { run, read, calls, list };
};

const azure = "azure.archive.ubuntu.com";
const canonical = [azure, "archive.ubuntu.com", "security.ubuntu.com"];

// The image's list once the first fallback ran: Azure gone, the three outside mirrors at its end.
const chain =
  "https://archive.ubuntu.com/ubuntu/\tpriority:2\n" +
  "https://security.ubuntu.com/ubuntu/\tpriority:3\n" +
  "http://mirrors.edge.kernel.org/ubuntu/\tpriority:4\n" +
  "http://mirror.math.princeton.edu/pub/ubuntu/\tpriority:5\n" +
  "http://ftp.osuosl.org/pub/ubuntu/\tpriority:6\n";

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
  expect(apt.read("sources.list.d/ubuntu.sources")).toBe(imageSources);
  expect(result.stdout).not.toContain("::warning::");
});

it("scenario: Azure dead on update, it leaves the list, security reads the list, try 2 passes", () => {
  const apt = box(image);
  const result = apt.run(install, ["update"]);
  expect(result.status).toBe(0);
  expect(apt.calls()).toEqual(["update", "update", installCall]);
  expect(apt.read("apt-mirrors.txt")).toBe(chain);
  expect(apt.read("sources.list.d/ubuntu.sources")).toBe(
    imageSources.replace("http://security.ubuntu.com/ubuntu/", apt.list),
  );
  expect(result.stdout).toContain("::warning::apt-get install failed or passed its limit, try 1 of 6");
  expect(result.stdout).toContain("::warning::dropping http://azure.archive.ubuntu.com/ubuntu/");
});

it("scenario: Azure dead on install only, the retry refreshes the lists before it installs", () => {
  const apt = box(image);
  const result = apt.run(install, ["install"]);
  expect(result.status).toBe(0);
  expect(apt.calls()).toEqual(["update", installCall, "update", installCall]);
});

it("scenario: update alone, as next's chromium step runs it, falls back the same way", () => {
  const apt = box(image);
  expect(apt.run(["update"], ["update"]).status).toBe(0);
  expect(apt.calls()).toEqual(["update", "update"]);
  expect(apt.read("apt-mirrors.txt")).toBe(chain);
});

it("scenario: every Canonical host dead, try 4 passes on the first outside mirror", () => {
  const apt = box(image);
  const result = apt.run(install, ["update"], canonical);
  expect(result.status).toBe(0);
  expect(apt.calls()).toEqual(["update", "update", "update", "update", installCall]);
  expect(apt.read("apt-mirrors.txt").split("\n")[0]).toBe("http://mirrors.edge.kernel.org/ubuntu/\tpriority:4");
});

it("scenario: every mirror dead, six tries, an error line and exit 1", () => {
  const apt = box(image);
  const result = apt.run(install, ["all"]);
  expect(result.status).toBe(1);
  expect(apt.calls()).toEqual(Array(6).fill("update"));
  expect(result.stdout).toContain("::error::apt-get install failed on every mirror, 6 tries");
});

it("scenario: no mirror list, deb822 sources read a list written from the chain", () => {
  const apt = box({ "sources.list.d/ubuntu.sources": deb822 });
  expect(apt.run(["update"], ["update"], canonical).status).toBe(0);
  expect(apt.calls()).toEqual(["update", "update", "update"]);
  expect(apt.read("sources.list.d/ubuntu.sources")).toBe(
    deb822
      .replace("http://azure.archive.ubuntu.com/ubuntu/", apt.list)
      .replace("http://security.ubuntu.com/ubuntu/", apt.list),
  );
  expect(apt.read("apt-mirrors.txt")).toBe(
    "http://mirrors.edge.kernel.org/ubuntu/\tpriority:3\n" +
      "http://mirror.math.princeton.edu/pub/ubuntu/\tpriority:4\n" +
      "http://ftp.osuosl.org/pub/ubuntu/\tpriority:5\n",
  );
});

it("scenario: no mirror list, one-line sources.list reads a list written from the chain", () => {
  const apt = box({ "sources.list": oneLine });
  expect(apt.run(["update"], ["update"]).status).toBe(0);
  expect(apt.read("sources.list")).toBe(
    `deb ${apt.list} jammy main restricted\n` +
      `deb ${apt.list} jammy-updates main restricted\n` +
      `deb ${apt.list} jammy-security main restricted\n`,
  );
  expect(apt.read("apt-mirrors.txt").split("\n")[0]).toBe("https://archive.ubuntu.com/ubuntu/\tpriority:2");
});

it("scenario: no mirror list and no sources file, a warning and the tries go on", () => {
  const apt = box({});
  const result = apt.run(["fallback"]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("::warning::no apt mirror list or Ubuntu sources");
});

it("scenario: fallback many times drops one mirror each, adds the outside ones once, trusts none", () => {
  const apt = box(image);
  const tops: string[] = [];

  for (let i = 0; i < 7; i++) {
    apt.run(["fallback"]);
    tops.push(apt.read("apt-mirrors.txt").split("\t")[0] ?? "");
  }

  expect(tops).toEqual([
    "https://archive.ubuntu.com/ubuntu/",
    "https://security.ubuntu.com/ubuntu/",
    "http://mirrors.edge.kernel.org/ubuntu/",
    "http://mirror.math.princeton.edu/pub/ubuntu/",
    "http://ftp.osuosl.org/pub/ubuntu/",
    // Used up, the list stays empty: apt then fails at once and the tries end.
    "",
    "",
  ]);
  const sources = apt.read("sources.list.d/ubuntu.sources");
  expect(sources).not.toMatch(/trusted|allow-unauthenticated/);
  expect(sources).toContain("Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg");
});

it.each([[[]], [["update", "zsh"]], [["install"]], [["upgrade"]]])("format: bad arguments exit 2: %j", (args) => {
  const apt = box(image);
  expect(apt.run(args).status).toBe(2);
  expect(apt.calls()).toEqual([]);
});
