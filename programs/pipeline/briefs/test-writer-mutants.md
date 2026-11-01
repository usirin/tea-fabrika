---
step: test-writer
job: mutants_answer
answer: Answered
slots:
  ticket: the ticket's id
  head: the build's head commit
  survived: each mutant with its id, mutator, original and replacement
  properties: the plan's Properties, so an answer can name what a mutant touches
  includes: the patterns a new file must match
  taken: files at the head that includes covers
  test_command: how to run one test file here
  note: on a later try, the Check's problems, sent instead of this brief
---

Mutation testing made small changes to the code at commit {head}. No test failed with these in, so a real bug of the same kind would pass too. Answer each one. You did not build this code.

# Mutants

Each id is `file:line:column:tag`.

{survived}

# The plan's Properties

{properties}

# What you may add

Only new files that match one of these:

{includes}

These exist already, so they are never written:

{taken}

# How to answer

Read the code at the mutant's line, and the tests that reach it. Then pick one.

- `test`: write a test that passes on the code as it is and fails with the mutant in. Give its exact name and file. Code runs it both ways.
- `cannot`: the mutant changes nothing a test can see. Show why: follow the code to where the two versions meet. The owner is asked.
- `noise`: a test could tell it apart, but it would only lock a detail no promise covers. Say why. The owner rates it. A "fix" sends it back to you for a test.

A real gap is not noise. A test that pins exact error text, a choice nobody made, or a tool's own string is not a fix, so that mutant is `noise`.

Your folder is read-only: your box refuses a write there, so neither a mutant nor a new test can be put in it or run there. Read the code, and work out how your test will end. Code writes your test and runs it with `{test_command}` after you, on the code as it is and with the mutant in.

If several mutants point at one missing check, one test may kill them all. Give each mutant its own answer.

# Your answer

- `files`: each new file, whole: `path` and `text`.
- `answers`: one for each mutant: `mutant`, `answer`, and either `test` and `file`, or `why`.
- `gaps`: what this brief left unclear, and what you did.

Plain short sentences.
