# Doc review: the default rubric

fabrika ships this rubric. A repository uses its own instead by naming a
folder in `fabrika.toml` (`[review] rubrics`), or a machine by naming one in
`tsh.toml` (`rubrics`).

## Per criterion

- Find the lines that meet each criterion. A criterion with no line to point
  at is not met.

## Standing checks

- **says-what-the-code-does**: a page that names a command, a flag, a file or
  an output says what the code at this commit does.
- **one-job-per-page**: a page teaches, shows how, describes or explains. It
  does not do two of those at once.
- **plain-words**: short sentences and everyday words. A new term is said
  plainly the first time it is used.
- **no-secret**: no key, token, password, personal name or personal path is
  added.
