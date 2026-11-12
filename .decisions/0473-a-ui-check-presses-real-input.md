---
id: 0473
title: A UI check drives the window only through real input and checks each promise the window makes in words, with component tests by role in jsdom and layout and focus on Playwright on Electron
status: accepted
date: 2026-11-07
tags: [ui, verification, tests, playwright, testing-library]
---

# 0473: A UI check drives the window only through real input and checks each promise the window makes in words, with component tests by role in jsdom and layout and focus on Playwright on Electron

```ts
// No: the test moves focus where the keyboard never could.
await bottomLine(page).getByRole("button", { name: /keys$/ }).focus();
// Yes: the test reaches it the way the hint says a person can.
for (let i = 0; i < 40 && !(await focusedIs(page, "keys")); i++) await page.keyboard.press("Tab");
expect(await focusedIs(page, "keys"), "the hint says 'tab to it'").toBe(true);
```

**What this decides:** how a UI check reaches the part it checks, in both versions.

## Context

A test that set focus by hand passed while Tab never reached the part. From
[UI verification](../docs/direction/ui-verification.md#u4-a-check-presses-what-a-person-presses),
U4 and its change.

## Decision

**A check presses what a person presses.**

- A check drives the window only through real input: keys, the pointer, the palette. No `.focus()`,
  no `dispatchEvent`, no `evaluate` that changes the page.
- Each promise the window makes in words ("tab to it", "esc leaves") has a check that does exactly
  that.
- Component tests use Testing Library by role and name, in jsdom. Layout, focus rings and the real
  tree stay with Playwright on Electron.

## Consequences

- A test window still stays out of the person's way (AGENTS.md, "Go easy on the machine").
