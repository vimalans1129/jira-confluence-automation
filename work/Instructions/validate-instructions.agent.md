- Validate all Markdown (`*.md`) files in the project for consistent formatting and report violations; fix them only when the user asks.
- **When to use**:
  + The user asks to validate, lint, check, or normalize Markdown formatting for one file, a folder, or the whole project.
  + Not for checking content accuracy, spelling, or whether the information is correct.
- **Scope**:
  + Include `**/*.md`; exclude `node_modules/`, `.git/`, `output/`, and any generated files.
  + Many files (more than ~15) or repeated runs: use script automation (Approach 3 in `backlog.md`, e.g. `tools/batch_ai.py`) instead of reading files one by one.
  + `*.agent.md`, `*.prompt.md` and `copilot-instructions.md` files are exempt from the title and heading-hierarchy rules (they intentionally use bullets only, no headers) but must pass all other checks.
  + In `*.agent.md` files, nested bullets may use `+` or `*` (top-level bullets must still use `-`).
- **Checks** (apply to each file):
  + **Title**: exactly one level-1 heading (`# `), on the first non-blank line (after front matter, if any).
  + **Heading hierarchy**: levels increase by one at a time (no `#` → `###`); no duplicate headings at the same level within a file; no trailing punctuation or trailing `#`.
  + **Heading spacing**: one blank line before and after every heading; a space after the `#` characters; ATX style (`#`) only, no underline style.
  + **Lists**: one marker style per file (`-` for bullets); consistent indentation (2 spaces for nested items); one blank line around a list; numbered lists increment sequentially.
  + **Checkboxes**: `- [ ]` or `- [x]` only (lowercase `x`, single space inside the brackets).
  + **Code blocks**: fenced with triple backticks, never indented; every fence has a language tag (`python`, `powershell`, `json`, `yaml`, `text`); fences are closed; blank line before and after.
  + **Tables**: header row plus separator row; same number of columns in every row; leading and trailing pipes; no empty header cells.
  + **Links**: no bare URLs (use `[text](url)` or `<url>`); no empty link text or target; relative links to project files must resolve to an existing file; no spaces in link targets.
  + **Images**: alt text present; target file exists.
  + **Whitespace**: no trailing spaces; no tabs; no more than one consecutive blank line; file ends with exactly one newline.
  + **Line endings**: consistent within a file (match the repository's existing style; do not mix LF and CRLF).
  + **Emphasis**: `**bold**` and `*italic*` only (no `__bold__` or `_italic_`); no spaces inside the markers.
  + **Inline code**: file names, paths, commands, config keys, and code identifiers are wrapped in backticks.
  + **Placeholders**: no leftover `TODO`, `TBD`, `FIXME`, or `lorem ipsum` unless intentionally tracked in `backlog.md`.
  + **Required sections** (only for files of these kinds):
    * `*-report.md`: title `# Module NN Completion Report`.
    * `walkthrough.md`: both a Summary section and a Quiz section.
    * Instruction files (`Instructions/*.agent.md`): listed in `main.agent.md` with Keywords.
- **Output**:
  + Report per file: path, then one line per violation as `line N — [check name] — what is wrong`.
  + End with a summary table: files checked, files passing, files failing, total violations by check.
  + Files with no violations are listed as passing, not detailed.
- **Constraints**:
  + Read each file completely before judging it; never validate from a partial view or a filename alone.
  + Report only what you verified; do not guess line numbers.
  + Never modify files during validation; apply fixes only after the user confirms, with minimal changes limited to the reported violations.
  + Do not change the meaning or wording of content while fixing formatting.
