# Skill review: the default rubric

fabrika ships this rubric. A repository uses its own instead by naming a
folder in `.fabrika/fabrika.toml` (`[review] rubrics`), or a machine by naming one in
`tsh.toml` (`rubrics`).

A skill page is text an agent reads and acts on. Read it as that agent would.

## Per criterion

- Find the lines that meet each criterion. A criterion with no line to point
  at is not met.

## Standing checks

- **one-reading**: each step has one reading. An agent that follows it to the
  letter does what the author meant.
- **says-when**: the page says when it applies and when it does not.
- **no-hidden-power**: the page asks for no tool, permission or network the
  task does not need.
- **no-secret**: no key, token, password, personal name or personal path is
  added.
