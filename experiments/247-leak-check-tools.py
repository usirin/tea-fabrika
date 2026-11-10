# Experiment 247 probe. Usage: python3 247-leak-check-tools.py <empty work folder> <gitleaks binary> <leakgrep.sh>
# Made-up repo probe: gitleaks 8.30.1 vs leakgrep.sh. Prints counts and file:line only.
import json, os, secrets, string, subprocess, sys, tempfile, pathlib, shutil
S, G, LG = sys.argv[1], sys.argv[2], sys.argv[3]
W = "zorblatt-quux"
repo = pathlib.Path(S) / "toy"
shutil.rmtree(repo, ignore_errors=True); repo.mkdir()
words = pathlib.Path(S) / "toy-words"; words.write_text(W + "\n")
cfg = pathlib.Path(S) / "toy-private.toml"
cfg.write_text('[extend]\nuseDefault = true\n\n[[rules]]\nid = "private-word"\ndescription = "a word from the private list"\nregex = \'\'\'(?i)zorblatt-quux\'\'\'\n')
cfg2 = pathlib.Path(S) / "toy-private-only.toml"
cfg2.write_text('title = "private words only"\n\n[[rules]]\nid = "private-word"\ndescription = "a word from the private list"\nregex = \'\'\'(?i)zorblatt-quux\'\'\'\n')
env = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.com", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.com", FABRIKA_LEAK_WORDS=str(words))
def git(*a):
    return subprocess.run(["git", "-C", str(repo), *a], capture_output=True, env=env, check=True).stdout
def commit(msg):
    git("add", "-A"); git("commit", "-q", "-m", msg, "--allow-empty")
    return git("rev-parse", "HEAD").decode().strip()
def gl(rng, config=cfg, extra=(), baseline=None):
    out = pathlib.Path(S) / "toy-out.json"
    cmd = ["nice", "-n", "15", G, "git", "--no-banner", "--redact", "-c", str(config), "--log-opts=" + rng, "-f", "json", "-r", str(out), "--exit-code", "0", *extra]
    if baseline: cmd += ["-b", str(baseline)]
    subprocess.run(cmd + [str(repo)], capture_output=True, env=env)
    return sorted(f'{x["RuleID"]} {x["File"]}:{x["StartLine"]}' for x in json.load(open(out)))
def ours(*diffargs):
    diff = git("diff", "--no-ext-diff", "--no-textconv", "--unified=0", *diffargs)
    r = subprocess.run(["sh", LG], input=diff, capture_output=True, env=env, cwd=repo)
    lines = diff.decode().splitlines(); hits = []
    for l in r.stderr.decode().splitlines():
        if " leak " not in l: continue
        kind, n = l.split()[2], int(l.split()[-1])
        f = next(lines[j][6:] for j in range(n - 1, -1, -1) if lines[j].startswith("+++ "))
        hits.append(f"{kind} {f}")
    return sorted(hits)
def show(name, v): print(f"{name}: {len(v)} {v}")
git("init", "-q", "-b", "main")
(repo / "README.md").write_text("toy\n"); base = commit("base")

# T1: a re-indent of lines that hold the word
(repo / "a.ts").write_text("".join(f"  const n{i} = '{W}'\n" for i in range(3)) + "plain\n"); c1 = commit("add")
(repo / "a.ts").write_text("".join(f"\tconst n{i} = '{W}'\n" for i in range(3)) + "plain\n"); c2 = commit("reindent")
print("T1 re-indent only (2 spaces to a tab), 3 lines hold the word")
show("  gitleaks range", gl(f"{c1}..{c2}"))
show("  gitleaks range with -w", gl(f"-w {c1}..{c2}"))
show("  gitleaks range with -b", gl(f"-b {c1}..{c2}"))
basef = pathlib.Path(S) / "toy-baseline.json"
subprocess.run([G, "git", "--no-banner", "--redact", "-c", str(cfg), f"--log-opts={base}..{c1}", "-f", "json", "-r", str(basef), "--exit-code", "0", str(repo)], capture_output=True, env=env)
show("  gitleaks range with a baseline made at the first commit", gl(f"{c1}..{c2}", baseline=basef))
show("  leakgrep diff", ours(c1, c2)); show("  leakgrep diff -w", ours("-w", c1, c2)); show("  leakgrep diff -b", ours("-b", c1, c2))

# T1b: first-time indent (wrapped in a block)
(repo / "b.ts").write_text(f"const m = '{W}'\n"); c3 = commit("add b")
(repo / "b.ts").write_text(f"if (x) {{\n\tconst m = '{W}'\n}}\n"); c4 = commit("wrap b")
print("T1b a line indented for the first time (wrapped in a block)")
show("  gitleaks", gl(f"{c3}..{c4}")); show("  gitleaks -w", gl(f"-w {c3}..{c4}")); show("  gitleaks -b", gl(f"-b {c3}..{c4}"))
show("  leakgrep", ours(c3, c4)); show("  leakgrep -w", ours("-w", c3, c4)); show("  leakgrep -b", ours("-b", c3, c4))

# T1c: the word appears by deleting a space: a real new leak that -w hides
(repo / "c.md").write_text("zorblatt- quux is two harmless halves\n"); c5 = commit("halves")
(repo / "c.md").write_text("zorblatt-quux is two harmless halves\n"); c6 = commit("join")
print("T1c the word is made by deleting one space (a real new leak)")
show("  gitleaks", gl(f"{c5}..{c6}")); show("  gitleaks -w", gl(f"-w {c5}..{c6}")); show("  gitleaks -b", gl(f"-b {c5}..{c6}"))
show("  leakgrep", ours(c5, c6)); show("  leakgrep -w", ours("-w", c5, c6)); show("  leakgrep -b", ours("-b", c5, c6))

# T2: added in one commit, removed in the next; the branch still carries it
git("checkout", "-q", "-b", "lane")
(repo / "d.md").write_text(f"oops {W}\n"); c7 = commit("oops")
(repo / "d.md").write_text("fixed\n"); c8 = commit("fix")
print("T2 added in one commit, removed in the next (both commits get pushed)")
show("  gitleaks over the pushed commits", gl(f"{c6}..{c8}"))
show("  leakgrep on the net diff, as botpush feeds it", ours(f"{c6}...{c8}"))

# T3: one made-up sample per kind our check knows, plus a few it does not
rnd = lambda n, a=string.ascii_letters + string.digits: "".join(secrets.choice(a) for _ in range(n))
home = "/" + "Users" + "/someone/code/x"; tmpu = "/" + "tmp" + "/claude-501/x"
samples = {
 "k01-home-path.md": f"see {home}\n",
 "k02-tmp-uid-path.md": f"see {tmpu}\n",
 "k03-em-dash.md": "a " + chr(0x2014) + " b\n",
 "k04-canvas-url.md": "https://claude" + ".ai/design/abc\n",
 "k05-word-upper.md": W.upper() + "\n",
 "k06-word-in-lockfile/pnpm-lock.yaml": f"name: {W}\n",
 "k07-word-allow-comment.ts": f"const a = '{W}' // gitleaks:allow\n",
 "k08-npm.txt": "token npm_" + rnd(36) + "\n",
 "k09-ghp.txt": "token ghp_" + rnd(36) + "\n",
 "k10-github-pat.txt": "token github_pat_" + rnd(22) + "_" + rnd(59) + "\n",
 "k11-sk-48.txt": "key sk-" + rnd(48) + "\n",
 "k12-sk-proj.txt": "key sk-proj-" + rnd(124) + "\n",
 "k13-aws.txt": "id AKIA" + rnd(16, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567") + "\n",
 "k14-pem.txt": "-----BEGIN " + "PRIVATE KEY-----\n" + rnd(64) + "\n" + rnd(64) + "\n-----END " + "PRIVATE KEY-----\n",
 "k15-slack.txt": "hook xoxb-" + rnd(12, string.digits) + "-" + rnd(12, string.digits) + "-" + rnd(24) + "\n",
 "k16-generic.ts": 'const apiKey = "' + rnd(40) + '"\n',
 "k17-ghp-base64.txt": "blob " + __import__("base64").b64encode(("ghp_" + rnd(36)).encode()).decode() + "\n",
 "k18-own-url.md": "https://github.com/usirin/tea-fabrika/pull/1\n",
 "k19-plus-plus.md": f"+ {W}\n",
}
for name, body in samples.items():
    p = repo / name; p.parent.mkdir(exist_ok=True); p.write_text(body)
c9 = commit("samples")
print("T3 one made-up sample per kind (files k01..k19)")
show("  gitleaks, default rules plus the word rule", gl(f"{c8}..{c9}"))
show("  gitleaks, same, --ignore-gitleaks-allow", gl(f"{c8}..{c9}", extra=["--ignore-gitleaks-allow"]))
show("  gitleaks, word rule alone (no default allowlist), --ignore-gitleaks-allow", gl(f"{c8}..{c9}", config=cfg2, extra=["--ignore-gitleaks-allow"]))
show("  leakgrep", ours(c8, c9))
# T4: removing a line that holds the word is not a leak
(repo / "k05-word-upper.md").unlink(); c10 = commit("remove")
print("T4 a commit that only removes a line holding the word")
show("  gitleaks", gl(f"{c9}..{c10}")); show("  leakgrep", ours(c9, c10))
