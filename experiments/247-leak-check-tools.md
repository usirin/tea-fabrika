# 247. Should an existing tool replace the hand-written leak check?

Run 2026-11-09 on origin/main at `8936c7e1`; the made-up repo was run again on 2026-11-10 with
`leakgrep.sh` at `169b24bb`, after [PR 709](https://github.com/usirin/tea-fabrika/pull/709)
changed it. Everything here is about **today's lead tooling**:
`.agents/skills/lead/scripts/leakgrep.sh` and the way `botpush.mjs` feeds it. Tracker ticket 504.
No model was called by the scripts, $0. One tool ran for real (gitleaks 8.30.1); the other three
were read from their own docs and not run.

**The answer.** No, not as a whole. Yes for one of its four jobs.

- **Keys: use the tool.** gitleaks carries 222 key rules where ours has 4 shapes. On made-up
  samples it found four kinds ours missed. Add it beside ours for keys, then drop our key shapes.
- **Private words, machine paths, the em dash, design canvas links: stay ours.** No tool has
  these rules. The private words can become a gitleaks rule file kept outside the repo, and that
  worked, but it buys nothing: it is the same substring match with more ways to skip a line.
- **The edge cases that cost us are not in the matching.** They are in which lines get checked,
  and a tool does not know them either. gitleaks flagged 3 of 3 re-indented lines, and its
  baseline did not help. Ours flagged them too until PR 709; now it reads them as old text.
- **Free and unused today:** GitHub's own secret scanning and push protection are switched off on
  this repo. They cost nothing on a public repo and need no code.

```sh
# Today: one net diff, added lines only, 4 built-in shapes plus the private word list.
git diff --unified=0 origin/main...HEAD | sh leakgrep.sh

# Tried here: every commit in the push, 222 key rules. Without -b it flags a re-indent again.
gitleaks git --redact --ignore-gitleaks-allow --log-opts="-b origin/main..HEAD" .
# Never -w, for either check: it hid a real leak in the test below.
```

## What our check does today

Read from the source, not from a summary.

- **What it reads.** A unified diff on stdin, or one whole draft file with `--text <file>`. In
  diff mode it checks only added lines, and skips the `+++` file header (`leakgrep.sh:78-90`).
- **What feeds it.** `botpush.mjs:22-27` runs `git diff --unified=0 origin/main...<head>`: the net
  change of the whole branch, not each commit. It runs before any key is read or any network call
  is made.
- **Private words.** Plain strings, one per line, matched as substrings in any letter case. The
  list is a private file under `~/.fabrika`, or the path in `FABRIKA_LEAK_WORDS`. The check refuses
  a list that sits inside the repo. This repo's own GitHub URL is cut out of a line first, since
  the URL holds an account name (`leakgrep.sh:28-47`, `:62`). This experiment never read the list.
- **Machine paths.** Home folders in their real case, the Mac temp folders, a Windows home, and a
  path under `/tmp` whose first part ends in a dash and a number
  ([0011](../.decisions/0011-leak-check-allows-plain-tmp-paths.md)).
- **Keys.** npm tokens, five GitHub token prefixes, GitHub fine-grained tokens, the OpenAI shapes
  by length, and a private key block's first line. The lengths were copied from gitleaks' own rule
  file, as the comment at `leakgrep.sh:48-51` says.
- **Spacing, since PR 709 (ticket 500).** An added line that only changes the spacing of a line the
  same file's diff removes is read as old text. Runs of spaces and tabs become one space, the ends
  are trimmed and one last `;` or `,` is dropped. Runs are never deleted, so two words never join.
  One removed line clears one added line, and only the kinds of hit it had (`leakgrep.sh:66-103`).
- **Two house rules that are not leaks.** An em dash, and a link to a design canvas.
- **How it fails.** Exit 1 on any hit, and it names only the kind and the added line's number,
  never the text. Exit 2 when it cannot read its input. A missing word list is a warning, and the
  built-in shapes still run. It fails closed: any hit stops the push for a hand check.
- **Where it does not run.** Not in CI. CI cannot hold the private list.

There are two copies of this check. `drive.ts:637-682` has its own, with different rules: it knows
the AWS key id shape, which `leakgrep.sh` does not, and it stops every temp path, which decision
0011 allows. One finding row covers it (`field/findings.jsonl`).

## What each tool can do

Read 2026-11-09 from each tool's own pages. Only gitleaks ran.

| Question | gitleaks 8.30.1 | TruffleHog 3.99.8 | detect-secrets 1.5.0 | GitHub push protection |
|---|---|---|---|---|
| Only a push's changes? | Yes. It reads `git log -p` and only additions; `--log-opts` picks the commits | Yes, `--since-commit` and `--branch` | No. It scans whole files, staged or tracked | Yes, on GitHub's side, after the bytes leave the laptop |
| Our private words, kept outside the repo? | Yes: a rule file named with `-c`, which wins over a file in the repo. Tried | A custom detector file with `--config`, marked alpha. Each needs a keyword | Only as a Python plugin. Its `--word-list` is the opposite: words to ignore | Custom patterns need Secret Protection, and would put the list on GitHub |
| Known findings | A baseline report, or fingerprints in an ignore file: commit, file, rule, line | An inline ignore comment. No baseline file | A baseline file: file name, a SHA-1 of the secret and the type, no line number | Bypass with a reason, per push |
| A line that only changed spacing | Flagged again, baseline or not. Tried | Not tried. It reads commits' changes too | Not flagged again if it is in the baseline | Not tried |
| No network, no account | Yes. Ran with the network denied, same result | No account. It checks found keys against their provider and looks for updates unless told not to | No account. It verifies over the network unless `--no-verify` | Needs GitHub. Free on a public repo |
| License | MIT | AGPL-3.0 | Apache-2.0 | a service |
| Exact version | The release file for 8.30.1, with its checksum file. Done here | The install script takes a tag | `pip install detect-secrets==1.5.0` | nothing to install |

Sources:

- gitleaks: [README at v8.30.1](https://github.com/gitleaks/gitleaks/blob/v8.30.1/README.md)
  ("gitleaks uses the `git log -p` command to scan patches", "gitleaks only looks at additions in
  the git history", the config order, baselines and fingerprints), its
  [rule file](https://github.com/gitleaks/gitleaks/blob/v8.30.1/config/gitleaks.toml), and the
  binary's own `--help`. The README on its main branch now opens with a warning: gitleaks is
  feature complete, later releases are security patches only, and its author has moved to
  [Betterleaks](https://github.com/betterleaks/betterleaks) (MIT, v1.10.0 on 2026-11-04).
- TruffleHog: [README](https://github.com/trufflesecurity/trufflehog/blob/main/README.md) ("Custom
  Regex Detector (alpha)", "at least one regular expression and keyword is required", "Don't check
  for updates", the AGPL 3 line) and its
  [custom detector page](https://github.com/trufflesecurity/trufflehog/blob/main/pkg/custom_detectors/CUSTOM_DETECTORS.md).
- detect-secrets: [README](https://github.com/Yelp/detect-secrets/blob/master/README.md) ("if a
  secret contains a word in the list we ignore it", "it avoids the overhead of digging through all
  git history"), and
  [potential_secret.py at v1.5.0](https://github.com/Yelp/detect-secrets/blob/v1.5.0/detect_secrets/core/potential_secret.py)
  ("line numbers aren't included"). Its last release is from 2024-05-06.
- GitHub: [about secret scanning](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning)
  (public repositories: "Secret scanning runs automatically for free"),
  [about push protection](https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection),
  and [custom patterns](https://docs.github.com/en/code-security/secret-scanning/using-advanced-secret-scanning-and-push-protection-features/custom-patterns/defining-custom-patterns-for-secret-scanning)
  ("you must ensure that Secret Protection is enabled on your repository"). This repo's settings,
  read through the API the same day: secret scanning and push protection both `disabled`.

## What ran

gitleaks 8.30.1, the darwin arm64 release file, its sha256 checked against the release's own
checksum file. No `sudo`, no account, under `nice -n 15`. Hits were recorded as rule and
`file:line` with `--redact`; no matched text was printed or saved. The numbers are in
[`results/247-leak-check-tools.json`](./results/247-leak-check-tools.json). The probe script is on
the branch `fabrikalfa/exp247-script`.

### On main's real history

| Run | Commits read | Hits | Commits with a hit | Real leaks |
|---|---|---|---|---|
| gitleaks, default rules, last 200 commits | 174 of the 200, since `git log -p` shows no patch for a merge (1.3 s) | 1 | 1 | 0 |
| ours, built-in shapes, empty word list, same 200 | 200 | 2 | 1 | 0 |
| gitleaks, default rules, all of main | 1,423 (72 MB, 4.3 s) | 13 | 5 | 0 |

Every hit was checked by hand, with long strings masked. All 13 are false alarms:

- 10 from the rule `generic-api-key`: eight public key fingerprints in a saved result
  (`experiments/results/230-checks.json`), the fixed sample key from the WebSocket standard
  (`experiments/150-browser-desk.ts:871`), and a made-up test prefix
  (`packages/fabrika/src/agents/acp/harness.env.laws.test.ts:19`).
- 3 from `private-key`: code that builds a key block's first line from made-up bytes
  (`redact.test.ts:77`, `sshsig.test.ts:113`) and a comment that quotes it (`sshsig.ts:194`). Ours
  flags the same first line.

So gitleaks with its default rules would have stopped 5 of 1,423 commits, each time wrongly. With
`generic-api-key` switched off it is 2 commits, the same ones ours stops. This measures false
alarms only. Main holds only what our check let through, so it cannot show a miss.

### On a made-up repo

A made-up word, `zorblatt-quux`, as a made-up private word: one line in a word file for ours, one
rule in a rule file for gitleaks, both outside the repo.

| Case | gitleaks | ours, before PR 709 | ours, on main now |
|---|---|---|---|
| 3 lines with the word, re-indented only | 3 hits | 3 hits | 0 |
| The same with a gitleaks baseline from the commit before | 3 hits | no baseline | no baseline |
| 1 line with the word, indented for the first time | 1 | 1 | 0 |
| The word made by deleting one space: a real new leak | 1 | 1 | 1 |
| Added in one commit, removed in the next | 1 | **0, missed** | **0, missed** |
| A commit that only removes a line with the word | 0 | 0 | 0 |

Git's own flags do part of the same job, for either check. With `-b` the re-indent gave 0 hits,
the first-time indent still gave 1, and the real leak still gave 1. With `-w` all three gave 0, so
`-w` hides the real leak. Ours on main now does better than `-b`: it clears the first-time indent
too and still finds the real leak.

Then one made-up sample per kind, 19 files:

- **Only ours found:** a home folder path, a temp path ending in a user id, an em dash, a design
  canvas link, and two random strings in the OpenAI shapes. gitleaks' OpenAI rule needs a marker
  that real keys carry and a random string does not, so that miss says little about real keys.
- **Only gitleaks found:** an AWS key id, a Slack bot token, a quoted 40-character value after
  `apiKey`, and a GitHub token written in base64.
- **Both found:** npm, two GitHub token kinds, a private key block, the word in upper case, the
  word on a line that starts with a plus.
- **gitleaks skipped the word twice.** In `pnpm-lock.yaml`, because its default rules skip lock
  files, images and fonts. And on a line that ends with the comment `gitleaks:allow`, which any
  agent can write. A rule file of its own without the defaults, and `--ignore-gitleaks-allow`,
  closed both.

## What this means

**The worry was that hand-rolled checks keep meeting cases nobody thought of.** Split in two, it is
half right.

- *Which text is a key* is the part a tool does better. It is a list of provider shapes that
  somebody else keeps current. Ours is 4 shapes copied from that list by hand.
- *Which lines to check* is where our edge cases came from: a plus at the start of a line (field
  note 2026-11-08-204), a temp path in a test (decision 0011), and a re-indent (ticket 500). A
  tool does not know these either. gitleaks reads the same `git log -p` and flags a re-indented
  line again. Its baseline matches on commit and line, so a new commit is a new finding.
- *What counts as private here* is ours alone: the private words, the machine paths and decision
  0011's line through `/tmp`, the em dash, the canvas links. No tool ships these, and each tool
  would hold them as custom rules we write and test anyway.

## Recommendation

1. **Keep `leakgrep.sh` for private words, machine paths, the em dash and canvas links.** Why:
   no tool covers them, and moving the word list into gitleaks rules adds two ways to skip a line
   for no gain. Cost: nothing. 90% sure.
2. **Add gitleaks for keys, beside ours, then delete our key shapes.** Pin 8.30.1 by its release
   file and checksum. Run it with `--redact`, `--ignore-gitleaks-allow`, a rule file named with
   `-c`, the ignore file path set outside the repo, `-b` in `--log-opts`, and `generic-api-key` off: 10 of its 13 hits
   here came from that one rule, all false, and a check that blocks needs about 0%. Why: 222 kept
   rules against 4 copied ones, and it found 4 kinds ours missed. What it costs: one more binary
   every lead laptop needs, about 30 lines in `botpush.mjs` with a law for each flag, and a hand
   check on the rare key-shaped test value, as today. About 1 to 2 agent hours. 75% sure. The
   doubt: gitleaks is frozen and its author moved to Betterleaks. A frozen MIT tool with security
   patches is fine for a first slice, but Betterleaks should be tried on the same probe before
   this is built. It could not run here.
3. **Check each pushed commit, not only the net diff.** Why: a word added in one commit and
   removed in the next passed our check, before and after PR 709, and both commits are pushed.
   Cost: a few lines in `botpush.mjs` and laws in `botpush.test.ts`, both exam paths. 85% sure.
   The spacing case needs nothing more in ours: PR 709 covers it, and better than `-b`.
4. **One check, not two.** `drive.ts` should call `leakgrep.sh` and lose its own copy. 85% sure.
5. **Switch on GitHub secret scanning and push protection for this repo.** Why: free on a public
   repo, no code, and it is the only check that also covers a push that did not go through
   `botpush.mjs`. It cannot hold our private words. It is a repo setting, so it is the owner's
   switch. 80% sure; not tried, since nothing here changes repo settings.

Not recommended: TruffleHog (AGPL, calls providers by default, custom rules are alpha) and
detect-secrets (whole files, no release since 2024, and its word list means the opposite of ours).

## What it cannot tell us

- **Whether gitleaks misses real keys.** No real key was used. Every sample was random text in a
  key's shape, and two of gitleaks' misses come from that.
- **Our real false alarm rate with the private word list.** The list was never read, so every
  replay ran with built-in shapes only. Field note 2026-11-08-205 is the last real count: 2 of 20
  pull requests stopped, both wrongly, before the lengths were fixed.
- **How any of this behaves on a real lane.** No push went through gitleaks. The 1,423 commits are
  squashed history that had already passed our check.
- **TruffleHog, detect-secrets and GitHub push protection in practice.** Their rows are from docs.
  Whether TruffleHog flags a re-indent is a guess from how it reads commits.
- **Betterleaks.** Version 1.10.0 was downloaded and its checksum matched, but the run was refused
  by the session's permission check, so it has no numbers here.
- **Words that differ only by odd letters.** Ours uses Python's `casefold`, gitleaks uses Go's
  `(?i)`. They can differ on a few non-English letters. Not tested.
- **Text that is not in a diff.** Pull request titles, bodies, commit messages and tracker posts
  were out of scope. `leakgrep.sh` reads only what it is handed.
