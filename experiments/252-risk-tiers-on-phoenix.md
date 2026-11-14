---
date: "2026-11-10"
summary: "Not about this repo's code. 457 merged pull requests on kamp-us/phoenix (2026-09-11 to 10-11), read-only `gh`, no model, $0. No. Tiers from phoenix's own control-plane and governed paths plus auth, migrations and infra put 22 low, 123 medium, 312 high (68%, mostly `claude-plugins/` and `.decisions/`). A fix pull request within 7 days on the same files that links the same issue or the pull request: low 0 of 22, medium 9.8% (5.7 to 16.3), high 7.4% (5.0 to 10.8), so high is not above medium. Size orders it: 50 lines or fewer 1.3%, over 400 lines 11.6%; at equal load size puts 31 of 35 fixed changes before two people, tiers 23. Reverts: 1 partial in 457. The pre-set \"any\" outcome is noise: 16 of 20 hand-checked detections false, as agent-written issues name hot files; 1 likely miss in 20 non-detections. Governed paths mark who may change the rules, not where bugs come from (about 70% sure). One repo, after its review gate."
---

# 252. Would a risk tier set from a pull request's paths have predicted which changes later needed fixing?

Run 2026-11-10 on the public repo [kamp-us/phoenix](https://github.com/kamp-us/phoenix), whose pull
requests go through an agent pipeline (today's fabrika) with a review gate. **No claim here is about
this repo's own code, today's or `next/`.** It is read-only data work: `gh` reads, a shallow clone and
three Python scripts. No model, no key, no agent ran, so the cost is $0 at any list price. Nothing was
posted to any GitHub repo. The scripts and raw pulls sit under `runs/risk-tiers/` on the owner's
machine, which git ignores; they are not on main or on any branch
([0027](../.decisions/0027-experiment-results-live-in-a-private-archive.md)).

**The answer: no, not on phoenix.** The cleanest outcome is a fix pull request merged within 7 days
that touches the same files and links the same issue or the pull request. By that outcome the
low tier had 0 of 22, the medium tier 12 of 123 (9.8%, 95% interval 5.7 to 16.3%) and the high tier
23 of 312 (7.4%, 5.0 to 10.8%). The high tier was not above the medium one. A rule from size alone did
separate them: small changes (50 lines or fewer) had 1 of 78 (1.3%, 0.2 to 6.9%), large ones (over 400
lines) 17 of 147 (11.6%, 7.3 to 17.7%), and those two intervals do not overlap. With the same number
of people per change, size would have put 31 of the 35 later-fixed changes in front of two people, and
the tiers only 23.

The path tiers also cost the most. Phoenix's own governed folders, its plugin of skills
(`claude-plugins/`) and its decisions (`.decisions/`), cover most of its work, so 312 of 457 pull
requests (68%) land in the high tier and would need two people: 747 person-reviews, against 526 for
the size rule's fixed cutoffs.

The lean this tested ("place people by risk, and set the tier from the change, not the author") is
not refuted by this. What fails is one way to read risk: phoenix's governed paths mark who may change
the rules, not where bugs come from. Those are two reasons to put a person in front of a change, and
this data says to keep them apart. About 70% sure; one repo, outcomes counted after its review gate
already ran.

```python
# The whole tier rule, as it ran (analyze.py). A pull request is high if any file is high,
# low if every file is low, else medium. ** is any depth, * one path segment.
HIGH = [".claude/**", ".github/**", ".claude-plugin/**", "packages/ci-required/**",
        "packages/fabrika-cli/src/ci/**", "biome.jsonc", "biome-plugins/**", "**/lefthook*", "**/.lefthook*",
        ".decisions/**", "claude-plugins/**", ".fabrika.jsonc",
        "apps/web/worker/features/pasaport/**", "apps/web/src/auth/**", "packages/authz/**",
        "packages/admin-grant/**", "apps/web/worker/features/user-admin/**",
        "apps/web/worker/db/drizzle/**", "packages/db-schema/**", "packages/migrations-guard/**",
        "apps/web/worker/db/drizzle.config.ts",
        "infra/**", "packages/cf-credentials/**", "**/alchemy.run.ts", "**/wrangler.*"]
LOW = ["**/*.md", "**/*.mdx", "**/docs/**", ".patterns/**", ".glossary/**", "reports/**", "ops/**",
       "**/*.test.*", "**/*.spec.*", "**/tests/**", "**/test/**", "**/__tests__/**", "**/test-fixtures/**",
       "**/fixtures/**", "**/*.testing.ts", "benchmarks/**"]
# Size baseline: lines = additions + deletions; small <= 50, mid 51..400, large > 400.
```

## The data

Phoenix's last merge was on 2026-10-18, so "the last 30 days" means the 30 days before work stopped.
The cohort is every pull request merged from 2026-09-11 to 2026-10-11: 457 of them, so no widening
was needed. It ends a week before the last merge so most 7-day fix windows had later work to look at.
Later merges count up to 2026-10-19 (460 pull requests pulled), issues opened up to 2026-10-26 (1,133
pulled). Files came from GraphQL, and from the REST files list for the 6 pull requests with more than
100 files. Commit messages came from a shallow clone of `main` since 2026-09-01 (818 commits).
GraphQL use was about 25 points of 5,000.

Most work there is a maintainer's sessions driving the pipeline: 448 of 457 came from people's
accounts, 9 from bots (dependency bumps and release pull requests). Activity fell off fast at the end:
104 merges on 2026-10-01 to 05, then 1 merge on 2026-10-06 to 11.

## The method

It was written to `runs/risk-tiers/method.md` before any outcome was computed, and was not changed
after.

1. **Tiers from paths only.** The high list is phoenix's own control-plane regex
   (`CONTROL_PLANE_RE` in `packages/fabrika-cli/src/guard/control-plane-re.ts`, the same paths as
   its `.github/CODEOWNERS`), plus its `governedRoots` from `.fabrika.jsonc` (`.decisions/`,
   `claude-plugins/`, the config itself), plus the product's auth (`pasaport`, `authz`,
   `admin-grant`, `user-admin`), migrations and schema, infra and secrets. A flag check was not
   possible from paths, so "additive behind a flag" was not used. Tier to people: low is nobody,
   medium one, high two.
2. **Two size baselines.** Fixed cutoffs (50 and 400 lines), and a share-matched rule that ranks by
   lines and gives the same counts as the tiers (22 nobody, 123 one, 312 two), so paths and size are
   compared at the same review load.
3. **Three outcomes, each a different detector.** (a) A revert: a later pull request or commit that
   says `This reverts commit <merge sha>`, `Reverts kamp-us/phoenix#N`, "revert ... #N", or a title
   starting "Revert" that names it. (b) A fix follow-up: a pull request merged within 7 days that
   shares a changed file (`pnpm-lock.yaml` and `package.json` do not count), is labeled `type:bug` or
   titled fix, bug, hotfix or regress, and links the same issue or names the pull request. (c) A bug
   issue: opened within 14 days, labeled `type:bug` or titled bug, broken, regress or fix, whose text
   names the pull request or one of its files by full path. "Any" is a or b or c.
4. **Wilson 95% intervals** for every rate. A hand check of 20 detections and 20 non-detections,
   drawn with seed 119120.

## What came back

Rates of each outcome, with 95% intervals. Outcome (c) and "any" are in the next section: the hand
check found them to be mostly false alarms.

| Group | Pull requests | (a) revert | (b) fix follow-up | (c) bug issue | any |
|---|---|---|---|---|---|
| Tier low | 22 (4.8%) | 0 | 0 (0 to 14.9%) | 4 (18.2%) | 18.2% (7.3 to 38.5) |
| Tier medium | 123 (26.9%) | 1 | 12, 9.8% (5.7 to 16.3) | 86 (69.9%) | 70.7% (62.2 to 78.0) |
| Tier high | 312 (68.3%) | 0 | 23, 7.4% (5.0 to 10.8) | 261 (83.7%) | 84.0% (79.5 to 87.6) |
| Size small, 50 lines or fewer | 78 (17.1%) | 0 | 1, 1.3% (0.2 to 6.9) | 42 (53.8%) | 55.1% (44.1 to 65.7) |
| Size mid, 51 to 400 | 232 (50.8%) | 0 | 17, 7.3% (4.6 to 11.4) | 169 (72.8%) | 73.3% (67.2 to 78.6) |
| Size large, over 400 | 147 (32.2%) | 1 | 17, 11.6% (7.3 to 17.7) | 140 (95.2%) | 95.2% (90.5 to 97.7) |
| Size share-matched, nobody | 22 | 0 | 0 (0 to 14.9) | 10 (45.5%) | 45.5% |
| Size share-matched, one | 123 | 0 | 4, 3.3% (1.3 to 8.1) | 77 (62.6%) | 63.4% |
| Size share-matched, two | 312 | 1 | 31, 9.9% (7.1 to 13.8) | 264 (84.6%) | 84.9% |

What it shows:

- **Reverts almost never happen.** One partial undo in 457: PR
  [9247](https://github.com/kamp-us/phoenix/pull/9247) turns cron off by default and puts one file
  back to its shape before PR [9226](https://github.com/kamp-us/phoenix/pull/9226). No pull request
  in the window is titled "Revert". Phoenix fixes forward.
- **On (b), the tiers do not order.** High (7.4%) sits below medium (9.8%). Inside each size bucket
  the same holds: mid-size medium 7 of 74 against mid-size high 10 of 149; large medium 5 of 28
  against large high 12 of 118. Low is 0 of 22, but its interval reaches 14.9%, so it says little.
- **Size orders, at every cut.** Small 1.3%, mid 7.3%, large 11.6%. At equal load, size puts 31 of
  the 35 fix-followed changes in front of two people and the tiers 23; both put all 35 in front of at
  least one person, the fixed size cutoffs 34.
- **Why the high tier is so big.** Of the 312 high pull requests, 231 touch `claude-plugins/` and 118
  `.decisions/` (one can touch both). The sensitive product paths are rare. Counted per glob, so a pull request can count twice: auth 8,
  migrations and schema 6, infra and secrets 5, CI workflows (`.github/`) 24. In phoenix the pipeline's own skills
  are the main product, and its governance rules cover that product.

## The hand check

Each sampled pull request was read against the later pull requests and issues that matched it.

- **"Any" detections, 20 read: 16 false alarms (80%, interval 58 to 92%).** Phoenix's issues are
  long, written by agents, and name file paths all the time. A hot file such as
  `claude-plugins/fabrika/skills/operate/SKILL.md` appears in dozens of issues that have nothing to
  do with the pull request: PR [9139](https://github.com/kamp-us/phoenix/pull/9139) matched 25
  issues this way, PR [9274](https://github.com/kamp-us/phoenix/pull/9274) 48. Only 2 were clearly
  real (PR [9343](https://github.com/kamp-us/phoenix/pull/9343) followed by
  [9351](https://github.com/kamp-us/phoenix/pull/9351), the last verb that "still refuses";
  PR [10428](https://github.com/kamp-us/phoenix/pull/10428) followed by
  [10563](https://github.com/kamp-us/phoenix/pull/10563)) and 2 borderline: PR
  [9555](https://github.com/kamp-us/phoenix/pull/9555) truly needed fixes
  ([9618](https://github.com/kamp-us/phoenix/pull/9618),
  [9631](https://github.com/kamp-us/phoenix/pull/9631)), but the detector reached it through
  unrelated issues, and [9903](https://github.com/kamp-us/phoenix/pull/9903) followed by
  [10221](https://github.com/kamp-us/phoenix/pull/10221) fills a gap of the same kind, not the same
  line.
- **Non-detections, 20 read: 1 likely miss (5%, interval 0.9 to 24%).** PR
  [9994](https://github.com/kamp-us/phoenix/pull/9994) split the danger color per scheme and, a day
  later, PR [10004](https://github.com/kamp-us/phoenix/pull/10004) fixed text on the new danger fill,
  but it links neither the pull request nor its issue. The other 19 had no later fix that undid or
  repaired them.
- **(b) alone, every one of its 37 pairs read by title and opening lines.** About 22 clearly fix the
  earlier change or finish what it left ("still refuses", "still probes", a speed fix of a new
  feature), about 11 are borderline (the same kind of gap, one step over), and 4 look unrelated
  (for example [9350](https://github.com/kamp-us/phoenix/pull/9350) to
  [9600](https://github.com/kamp-us/phoenix/pull/9600)). So about 10% false, which is why the
  answer above rests on (b). This read was by title, not a full read of each diff.
- **(c) is broken as written, even its "names the pull request" half.** An issue often cites pull
  requests as examples: one issue on how merges close issues names six unrelated ones. After the
  check, a narrower (c) that keeps only issues naming the pull request (decided after seeing the
  data, so only a hint) gives low 1 of 22, medium 15 of 123 (12.2%), high 42 of 312 (13.5%), and by
  size small 6.4%, mid 11.6%, large 17.7%. Tiers again do not order medium against high; size does.

## What it cannot tell us

- **One repo, and an odd one.** Phoenix builds the pipeline that reviews it, so its "governance"
  paths are its busiest product code. A repo whose governed paths are rarely touched could see the
  tiers do better. And phoenix's work is mostly one maintainer's agent sessions, so author and change
  are hard to tell apart here.
- **Every outcome is after review.** Phoenix's review gate ran on every pull request. A tier that
  matched the gate's own strictness might show nothing, because the gate already caught what it
  would catch. This measures what got past review, not what a person would have caught.
- **Size has a built-in edge on (b) and (c).** A pull request with more files has more chances to
  share a file with a later fix or appear in a later issue. Some of size's win is that, not risk.
  The data cannot split the two.
- **Survivorship and the quiet end.** Only merged pull requests count. Work that was abandoned, or
  closed and redone, is not here. The 104 pull requests merged on 2026-10-01 to 05 had only a few
  merges after them, so their fix rates are low for that reason.
- **Small counts.** The low tier has 22 pull requests and the sensitive product paths (auth,
  migrations, infra) at most 19 between them, too few to say anything about those paths alone.
- **The detectors miss.** A fix that links nothing, or comes in a pull request that touches other
  files, is not counted. The hand check found 1 such miss in 20; the true rate could be up to about
  a quarter.
- **"Needed fixing" is not "harmed anyone".** No detector knows whether a follow-up fixed a real
  breakage or polished a working change.

## Cost

$0. No model was called; the run was `gh` reads (about 25 GraphQL points and about 15 REST calls),
one shallow clone and three Python scripts of about 20 seconds in all.
