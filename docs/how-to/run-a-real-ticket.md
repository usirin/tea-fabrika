# Run a real ticket

Run the first-generation factory on one GitHub issue, in a pnpm monorepo
checked out on this machine. The change lands in a local branch. Nothing is
pushed, and nothing is written to GitHub.

The host is `legacy/src/real.ts`. Every setting it reads is listed in the
comment at the top of that file.

## Before you start

- This repo is installed: `pnpm install` at its root.
- The `claude` CLI is installed and logged in.
- `gh` is logged in. The run reads the issue once with it.
- You have `TYPESAFE_API_KEY` for Jev.

## Steps

1. Make the working copy the builder works in:

   ```sh
   git -C <repo> worktree add -b work-branch <folder> origin/main
   ```

2. Make the branch the change lands in. Nobody may have it checked out.

   ```sh
   git -C <repo> branch landing-branch origin/main
   ```

3. Install the working copy's packages:

   ```sh
   pnpm -C <folder> install
   ```

4. From this repo's root, start the run. `PACKAGE` is the package whose tests
   the issue's examples join.

   ```sh
   ISSUE=owner/repo#n REPO=<folder> BASE=landing-branch RUN=<run folder> \
     PACKAGE=packages/tea TYPESAFE_API_KEY=... pnpm real
   ```

5. When the run stops at a park, it prints the `ANSWER` to give. Run it again
   with that answer. The run keeps its issue, repo, base and package, so `RUN`
   and the key are enough:

   ```sh
   RUN=<run folder> TYPESAFE_API_KEY=... ANSWER='<json>' pnpm real
   ```

   The last park is the approval of the finished commit. Once it is answered,
   the change lands in `landing-branch`.

## Stop after triage

Add `UNTIL=triage` to the command in step 4. The run stops once triage is
done, before the lane touches the repo, and prints the whole rewrite.

- Compare `<run folder>/ours-enriched.md` with
  `<run folder>/fabrika-enriched.md`. The second exists only when fabrika's
  triage had already rewritten the issue.
- To go on and build, run the same command without `UNTIL`. The lane's first
  step was kept asked, so it starts from there.

## Stop and carry on

Press Ctrl-C at any point. To carry on, run it again with `RUN` and the key:

```sh
RUN=<run folder> TYPESAFE_API_KEY=... pnpm real
```

## Change the floors and limits

This run reads its knobs (the Jev floors, the try limit, how much of a log
Jev reads) from the file `CONFIG` names. Without it, it uses today's values.
The keys are in `legacy/src/settings.ts`.

```sh
CONFIG=<folder>/legacy-knobs.toml ISSUE=owner/repo#n REPO=<folder> BASE=landing-branch \
  RUN=<run folder> PACKAGE=packages/tea TYPESAFE_API_KEY=... pnpm real
```

Keep that file apart from the repository's own `fabrika.toml`. The
repository's file sits at its root and is read by fabrika's tsh
(`packages/fabrika/src/pipeline/settings.ts`). It lists the add-on packs (`packs = [...]` and
`[pack."<name>"]`), not these knobs. Each reader refuses the other's keys, so
one file cannot serve both.

Where fabrika's tsh reads `fabrika.toml` from (`packages/fabrika/src/pipeline/settings-source.ts`):

- `tsh.toml` names a target (`repo`, or `clone`): the target's file, as
  committed on its default branch. Commit and merge a change to it before you
  start tsh. A change on a branch, or a file in the clone's folder, is not
  read. tsh fetches the clone first, and makes it when it is not there.
- No target: the file at the root of the folder tsh starts in.
- tsh's first line on stderr says which, for example
  `fabrika.toml: acme/widgets@main (1a2b3c4)`. A missing file reads
  `, not there: every default`.
- The packs it names are found from the folder tsh starts in, not from the
  target: install them there.

## See also

- [`legacy/README.md`](../../legacy/README.md): what each file of the factory
  does, including vetting and the tests a run writes.
- [`legacy/src/real.ts`](../../legacy/src/real.ts): every setting, such as
  `CONFIG` and `MODEL`.
