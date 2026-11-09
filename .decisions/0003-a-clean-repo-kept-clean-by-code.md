---
id: 0003
title: The repo is cut down to what today's app needs, then lint and format checks keep it clean, never discipline
status: accepted
date: 2026-11-09
tags: [cleanup, lint, format, repo]
---

# 0003: The repo is cut down to what today's app needs, then lint and format checks keep it clean, never discipline

**What this decides:** the repo gets an ambitious cleanup, and code checks hold the result.

## Context

The repo has grown many folders, drafts and old parts. A rule that asks every agent to keep it tidy
is a rule nobody can check, so the mess comes back.

## Decision

**Remove as much as possible without breaking today's app, then let checks keep it that way.**

- The cleanup removes everything today's app does not need to build, run and pass its tests.
- After it, `pnpm lint` and `pnpm format` checks hold the clean state. A rule that keeps the repo
  clean is code, not a line in a doc an agent must remember.

## Consequences

- This file records only the direction. The cleanup plan is still being written; it decides what
  goes, in what order, and which checks hold each part.
