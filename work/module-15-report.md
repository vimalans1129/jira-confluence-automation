# Module 15 Completion Report

## Script Metadata

- Filename: `tools/validate_markdown.py`
- Language: Python 3 (standard library only)
- Purpose: Bulk-validates every Markdown file under a project root for consistent formatting (title and heading rules, lists, checkboxes, code fences, tables, links, images, emphasis, inline code, whitespace, line endings, placeholders, required sections) following `Instructions/validate-instructions.agent.md`. It writes one PASS/FAIL section per file to a Markdown report, listing good practices for passing files and failure reasons with line numbers for failing files. It never modifies the validated files.

## Script Contents

~~~python
"""Validate Markdown formatting per Instructions/validate-instructions.agent.md.

Usage:
    python tools/validate_markdown.py [--root DIR] [--output FILE]

Writes one section per Markdown file (PASS with good practices, or FAIL with reasons).
Exit code is 1 if any file fails. The script never modifies the validated files.
"""
import argparse
import re
import sys
from pathlib import Path
from urllib.parse import unquote

EXCLUDED_DIRS = {".git", "node_modules", "output"}
FENCE_RE = re.compile(r"^(\s*)(`{3,}|~{3,})(.*)$")
HEADING_RE = re.compile(r"^(#{1,6})(\s+)(.*?)\s*$")
LIST_RE = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
CHECKBOX_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+\[([^\]`]{0,2})\](?!\()(?=\s|$)")
SEPARATOR_RE = re.compile(r"^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$")
INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
LINK_RE = re.compile(r"(!?)\[([^\]]*)\]\(([^)]*)\)")
BARE_URL_RE = re.compile(r"https?://[^\s)>\]]+")
BOLD_RE = re.compile(r"\*\*([^*\n]+)\*\*")
UNDERSCORE_BOLD_RE = re.compile(r"(?<![\w_])__(?=\S)[^_\n]+?(?<=\S)__(?![\w_])")
UNDERSCORE_ITALIC_RE = re.compile(r"(?<![\w_])_(?=\S)[^_\n]+?(?<=\S)_(?![\w_])")
FILE_TOKEN_RE = re.compile(r"(?<![\w/\\.-])[\w-]+(?:[/\\][\w.-]+)*\.(?:py|md|ya?ml|json|toml|txt|pptx|ps1|ini|cfg)\b")
PLACEHOLDER_RE = re.compile(r"\b(TODO|TBD|FIXME)\b|lorem ipsum", re.IGNORECASE)
REPORT_TITLE_RE = re.compile(r"^# Module \d+ Completion Report$")

GOOD_PRACTICES = {
    "title": "Single H1 title on the first line",
    "heading-hierarchy": "Heading levels increase one at a time with no duplicate headings",
    "heading-format": "ATX headings with a space after `#`, blank lines around them, no trailing punctuation",
    "list-style": "Consistent bullet markers, 2-space nesting and sequential numbering; lists separated from text by blank lines",
    "checkbox": "Task checkboxes use the standard `[ ]` / `[x]` form",
    "code-fence": "Fenced code blocks are closed, tagged with a language and surrounded by blank lines",
    "table": "Tables have a separator row, equal column counts and leading/trailing pipes",
    "links": "Links use `[text](url)` with non-empty text, valid targets and no bare URLs",
    "images": "Images have alt text and existing targets",
    "emphasis": "Emphasis uses `**bold**` / `*italic*` without inner spaces",
    "inline-code": "File names and paths are wrapped in backticks",
    "whitespace": "No trailing spaces, tabs or repeated blank lines; ends with a single newline",
    "line-endings": "Consistent line endings",
    "placeholders": "No leftover TODO/TBD/FIXME placeholders",
    "required-sections": "Required sections/title for this file type are present",
}


def strip_inline(text: str) -> str:
    return INLINE_CODE_RE.sub("", text)


def split_row(row: str) -> list:
    cells = re.split(r"(?<!\\)\|", row.strip())
    if cells and cells[0] == "":
        cells = cells[1:]
    if cells and cells[-1] == "":
        cells = cells[:-1]
    return cells


def validate(path: Path, root: Path) -> tuple:
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    violations = []
    applicable = {"whitespace", "line-endings", "placeholders"}

    def add(check, line, msg):
        violations.append((check, line, msg))

    crlf = raw.count(b"\r\n")
    lf = raw.count(b"\n") - crlf
    if crlf and lf:
        add("line-endings", 0, f"mixed line endings ({crlf} CRLF, {lf} LF)")

    lines = text.splitlines()
    is_agent = path.name.endswith(".agent.md")
    # Thin IDE wrapper files have no title by design, like instruction files.
    no_title_ok = is_agent or path.name.endswith(".prompt.md") or path.name == "copilot-instructions.md"

    if not text.endswith("\n"):
        add("whitespace", len(lines), "file does not end with a newline")
    elif re.search(r"(\r?\n){2,}\Z", text):
        add("whitespace", len(lines), "file ends with more than one newline")

    skip = [False] * len(lines)
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                for j in range(i + 1):
                    skip[j] = True
                break

    in_fence = [False] * len(lines)
    fence_marker = None
    fence_start = 0
    for i, line in enumerate(lines):
        if skip[i]:
            continue
        m = FENCE_RE.match(line)
        if fence_marker is None:
            if m:
                applicable.add("code-fence")
                fence_marker, fence_start = m.group(2)[0] * len(m.group(2)), i
                in_fence[i] = True
                if not m.group(3).strip():
                    add("code-fence", i + 1, "opening code fence has no language tag")
                if i > 0 and lines[i - 1].strip():
                    add("code-fence", i + 1, "no blank line before code fence")
        else:
            in_fence[i] = True
            if m and m.group(2)[0] == fence_marker[0] and len(m.group(2)) >= len(fence_marker) and not m.group(3).strip():
                fence_marker = None
                if i + 1 < len(lines) and lines[i + 1].strip():
                    add("code-fence", i + 2, "no blank line after code fence")
    if fence_marker is not None:
        add("code-fence", fence_start + 1, "code fence is never closed")

    def is_text(i):
        return not skip[i] and not in_fence[i]

    blank_run = 0
    for i, line in enumerate(lines):
        if skip[i]:
            continue
        if "\t" in line and not in_fence[i]:
            add("whitespace", i + 1, "contains a tab character")
        if line != line.rstrip() and not in_fence[i]:
            add("whitespace", i + 1, "trailing spaces")
        if line.strip() == "":
            blank_run += 1
            if blank_run == 2 and not in_fence[i]:
                add("whitespace", i + 1, "more than one consecutive blank line")
        else:
            blank_run = 0

    # Headings
    headings = []
    for i, line in enumerate(lines):
        if not is_text(i):
            continue
        m = HEADING_RE.match(line)
        if m:
            headings.append((i, len(m.group(1)), m.group(3)))
            applicable.add("heading-format")
            if i > 0 and lines[i - 1].strip():
                add("heading-format", i + 1, "no blank line before heading")
            if i + 1 < len(lines) and lines[i + 1].strip():
                add("heading-format", i + 1, "no blank line after heading")
            if re.search(r"[.:;,!]$", m.group(3)):
                add("heading-format", i + 1, "heading ends with punctuation")
            if re.search(r"\s#+$", m.group(3)):
                add("heading-format", i + 1, "heading has trailing # characters")
        elif re.match(r"^#{1,6}[^#\s]", line):
            applicable.add("heading-format")
            add("heading-format", i + 1, "missing space after # in heading")
        elif re.match(r"^=+\s*$", line) or (re.match(r"^-{2,}\s*$", line) and i > 0 and lines[i - 1].strip()
                                            and not lines[i - 1].lstrip().startswith("|")
                                            and not LIST_RE.match(lines[i - 1]) and not HEADING_RE.match(lines[i - 1])):
            applicable.add("heading-format")
            add("heading-format", i + 1, "setext (underline) heading; use ATX `#` style")

    if not no_title_ok and headings:
        applicable.update({"title", "heading-hierarchy"})
        h1s = [h for h in headings if h[1] == 1]
        first = next((i for i, l in enumerate(lines) if not skip[i] and l.strip()), None)
        if len(h1s) != 1:
            add("title", h1s[1][0] + 1 if len(h1s) > 1 else 1, f"expected exactly one H1, found {len(h1s)}")
        elif h1s[0][0] != first:
            add("title", h1s[0][0] + 1, "H1 is not the first non-blank line")
        prev_level = 0
        seen = {}
        for i, level, title in headings:
            if prev_level and level > prev_level + 1:
                add("heading-hierarchy", i + 1, f"heading jumps from H{prev_level} to H{level}")
            prev_level = level
            key = (level, title.lower())
            if key in seen:
                add("heading-hierarchy", i + 1, f"duplicate H{level} heading '{title}' (first at line {seen[key]})")
            else:
                seen[key] = i + 1
    elif not no_title_ok and not headings:
        applicable.add("title")
        add("title", 1, "no H1 title found")

    # Lists and checkboxes
    ordered_last = {}
    for i, line in enumerate(lines):
        if not is_text(i):
            continue
        m = LIST_RE.match(line)
        stripped = line.strip()
        if m:
            applicable.add("list-style")
            indent, marker = len(m.group(1)), m.group(2)
            if marker[0].isdigit():
                for k in [k for k in ordered_last if k > indent]:
                    del ordered_last[k]
                num = int(marker[:-1])
                last = ordered_last.get(indent)
                if last is not None and num != last + 1 and not (num == 1 and last == 1):
                    add("list-style", i + 1, f"numbered list jumps from {last} to {num}")
                ordered_last[indent] = num
            else:
                ordered_last.clear()
                allowed = "-" if (indent == 0 or not is_agent) else "-+*"
                if marker not in allowed:
                    add("list-style", i + 1, f"bullet marker '{marker}' used; expected '-'")
            if indent % 2:
                add("list-style", i + 1, f"nested list indented {indent} spaces (expected multiple of 2)")
            if i > 0 and lines[i - 1].strip() and not LIST_RE.match(lines[i - 1]) and not lines[i - 1].startswith(" ") \
                    and not HEADING_RE.match(lines[i - 1]) and not lines[i - 1].lstrip().startswith(("|", ">", "<!--")) \
                    and not in_fence[i - 1] and not skip[i - 1]:
                add("list-style", i + 1, "list is not preceded by a blank line")
            cb = CHECKBOX_RE.match(line)
            if cb:
                applicable.add("checkbox")
                if cb.group(1) not in (" ", "x"):
                    add("checkbox", i + 1, f"checkbox '[{cb.group(1)}]' is not '[ ]' or '[x]'")
        elif stripped:
            if not line.startswith(" ") and not HEADING_RE.match(line):
                ordered_last.clear()
            if i > 0 and LIST_RE.match(lines[i - 1]) and not line.startswith(" ") and not HEADING_RE.match(line) \
                    and not stripped.startswith(("|", ">", "<!--")) and not FENCE_RE.match(line):
                add("list-style", i + 1, "list is not followed by a blank line")
        elif not stripped:
            pass
        if HEADING_RE.match(line):
            ordered_last.clear()

    # Tables
    i = 0
    while i < len(lines):
        if is_text(i) and lines[i].lstrip().startswith("|"):
            j = i
            while j < len(lines) and is_text(j) and lines[j].lstrip().startswith("|"):
                j += 1
            block = lines[i:j]
            applicable.add("table")
            if len(block) < 2 or not SEPARATOR_RE.match(block[1].strip()):
                add("table", i + 1, "table has no header separator row")
            else:
                widths = [len(split_row(r)) for r in block]
                if len(set(widths)) > 1:
                    bad = next(k for k, w in enumerate(widths) if w != widths[0])
                    add("table", i + bad + 1, f"row has {widths[bad]} columns, header has {widths[0]}")
                if any(not c.strip() for c in split_row(block[0])):
                    add("table", i + 1, "table has an empty header cell")
            for k, row in enumerate(block):
                if not row.rstrip().endswith("|"):
                    add("table", i + k + 1, "table row has no trailing pipe")
                    break
            if i > 0 and lines[i - 1].strip():
                add("table", i + 1, "no blank line before table")
            if j < len(lines) and lines[j].strip():
                add("table", j + 1, "no blank line after table")
            i = j
        else:
            i += 1

    # Links, images, emphasis, inline code, placeholders
    for i, line in enumerate(lines):
        if not is_text(i):
            continue
        prose = strip_inline(line)
        if INLINE_CODE_RE.search(line):
            applicable.add("inline-code")
        for m in LINK_RE.finditer(INLINE_CODE_RE.sub("X", line)):
            is_image, label, target = m.group(1) == "!", m.group(2), m.group(3).strip()
            check = "images" if is_image else "links"
            applicable.add(check)
            if is_image and not label.strip():
                add(check, i + 1, "image has no alt text")
            if not is_image and not label.strip():
                add(check, i + 1, "link has empty text")
            if not target:
                add(check, i + 1, f"{check[:-1]} has empty target")
                continue
            bare = target.strip("<>")
            if " " in bare and not target.startswith("<"):
                add(check, i + 1, f"target contains spaces without <>: {target}")
                continue
            if re.match(r"^(https?:|mailto:|#)", bare):
                continue
            rel = unquote(bare.split("#")[0])
            if rel:
                candidate = Path(rel) if rel.startswith("/") and Path(rel).is_absolute() else path.parent / rel
                if not candidate.exists():
                    add(check, i + 1, f"target does not exist: {bare}")
        remainder = LINK_RE.sub("", re.sub(r"<https?://[^>]+>", "", prose))
        if BARE_URL_RE.search(remainder):
            applicable.add("links")
            add("links", i + 1, f"bare URL: {BARE_URL_RE.search(remainder).group(0)}")
        flat = LINK_RE.sub("", prose)
        if BOLD_RE.search(flat) or UNDERSCORE_BOLD_RE.search(flat) or UNDERSCORE_ITALIC_RE.search(flat):
            applicable.add("emphasis")
        for m in BOLD_RE.finditer(flat):
            if m.group(1) != m.group(1).strip():
                add("emphasis", i + 1, f"spaces inside bold markers: **{m.group(1)}**")
        if UNDERSCORE_BOLD_RE.search(flat):
            add("emphasis", i + 1, "uses __bold__; use **bold**")
        elif UNDERSCORE_ITALIC_RE.search(flat):
            add("emphasis", i + 1, "uses _italic_; use *italic*")
        no_url = BARE_URL_RE.sub("", flat)
        for m in FILE_TOKEN_RE.finditer(no_url):
            applicable.add("inline-code")
            add("inline-code", i + 1, f"file/path not in backticks: {m.group(0)}")
            break
        if PLACEHOLDER_RE.search(prose):
            add("placeholders", i + 1, f"placeholder text: {PLACEHOLDER_RE.search(prose).group(0)}")

    # Required sections per file type
    applies = False
    if re.search(r"-report\.md$", path.name):
        applies = True
        first_h1 = next((l for l in lines if l.startswith("# ")), "")
        if not REPORT_TITLE_RE.match(first_h1):
            add("required-sections", 1, "report title must be '# Module NN Completion Report'")
    if path.name.lower() == "walkthrough.md":
        applies = True
        for name in ("Summary", "Quiz"):
            if not any(re.match(rf"^#+\s+.*{name}", l, re.IGNORECASE) for l in lines):
                add("required-sections", 1, f"missing {name} section")
    catalog = path.parent / "main.agent.md"
    if is_agent and path.name != "main.agent.md" and catalog.exists():
        applies = True
        cat_lines = catalog.read_text(encoding="utf-8", errors="replace").splitlines()
        idx = next((k for k, l in enumerate(cat_lines) if f"`./Instructions/{path.name}`" in l or f"({path.name})" in l
                    or f"/{path.name}" in l), None)
        if idx is None:
            add("required-sections", 1, "not listed in main.agent.md catalog")
        elif not any("Keywords:" in l for l in cat_lines[idx + 1: idx + 5]):
            add("required-sections", 1, "catalog entry in main.agent.md has no Keywords")
    if applies:
        applicable.add("required-sections")

    failed = {v[0] for v in violations}
    good = [GOOD_PRACTICES[c] for c in GOOD_PRACTICES if c in applicable and c not in failed]
    return violations, good


def collect(root: Path, exclude: Path) -> list:
    files = []
    for p in root.rglob("*.md"):
        rel_parts = set(p.relative_to(root).parts[:-1])
        if rel_parts & EXCLUDED_DIRS or p.resolve() == exclude.resolve():
            continue
        files.append(p)
    return sorted(files)


def main() -> int:
    default_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default=str(default_root), help="project root (default: repository root)")
    parser.add_argument("--output", default=str(Path(__file__).resolve().parents[1] / "markdown-validation-report.md"))
    args = parser.parse_args()

    root, output = Path(args.root).resolve(), Path(args.output).resolve()
    files = collect(root, output)
    results = []
    for f in files:
        violations, good = validate(f, root)
        results.append((f, violations, good))
        print(f"{'FAIL' if violations else 'PASS'}  {f.relative_to(root)}")

    passed = sum(1 for _, v, _ in results if not v)
    out = ["# Markdown Validation Report", "",
           "Generated by `tools/validate_markdown.py` using `Instructions/validate-instructions.agent.md`.", "",
           "## Summary", "",
           "| Metric | Count |", "|--------|-------|",
           f"| Files processed | {len(results)} |", f"| Passed | {passed} |",
           f"| Failed | {len(results) - passed} |",
           f"| Total violations | {sum(len(v) for _, v, _ in results)} |", "",
           "| File | Result |", "|------|--------|"]
    for f, v, _ in results:
        out.append(f"| `{f.relative_to(root).as_posix()}` | {'PASS' if not v else f'FAIL ({len(v)})'} |")
    out += ["", "## Results", ""]
    for f, violations, good in results:
        out += [f"### `{f.relative_to(root).as_posix()}`", ""]
        if violations:
            out += ["**Result:** FAIL", "", "Reasons for failure:", ""]
            shown = violations[:25]
            for check, line, msg in shown:
                out.append(f"- Line {line} — {check} — {msg}" if line else f"- {check} — {msg}")
            if len(violations) > len(shown):
                out.append(f"- ... and {len(violations) - len(shown)} more violation(s)")
        else:
            out += ["**Result:** PASS", "", "Good practices followed:", ""]
            out += [f"- {g}" for g in good]
        out.append("")
    output.write_text("\n".join(out), encoding="utf-8", newline="\n")
    print(f"\n{passed}/{len(results)} passed. Report: {output}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
~~~

## Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--root` | Project root directory to scan recursively for `*.md` files (`.git`, `node_modules` and `output` folders are skipped) | Repository root (two levels above the script) |
| `--output` | Path of the Markdown report file to write; the report file itself is excluded from validation | `work/markdown-validation-report.md` (next to the `tools` folder) |
| `-h`, `--help` | Show usage help | n/a |

Exit code is `0` when all files pass and `1` when any file fails.

## Test Run Output

Command (two test files, one well-formatted and one with deliberate problems):

~~~text
python tools\validate_markdown.py --root <test-folder>\mdtest --output <test-folder>\test-out.md
~~~

Console output:

~~~text
��F A I L     b a d . m d 
 
 P A S S     g o o d . m d 
 
 
 
 1 / 2   p a s s e d .   R e p o r t :   C : \ U s e r s \ V i m a l a n S a d h a s i v a m \ . c o p i l o t \ s e s s i o n - s t a t e \ 6 8 5 3 1 0 d e - d 7 d 8 - 4 e f 9 - 9 0 0 4 - 4 2 8 3 9 b 0 6 f c 8 3 \ f i l e s \ t e s t - o u t . m d 
 
 
~~~

Generated report:

~~~markdown
# Markdown Validation Report

Generated by `tools/validate_markdown.py` using `Instructions/validate-instructions.agent.md`.

## Summary

| Metric | Count |
|--------|-------|
| Files processed | 2 |
| Passed | 1 |
| Failed | 1 |
| Total violations | 8 |

| File | Result |
|------|--------|
| `bad.md` | FAIL (8) |
| `good.md` | PASS |

## Results

### `bad.md`

**Result:** FAIL

Reasons for failure:

- Line 4 — code-fence — opening code fence has no language tag
- Line 4 — code-fence — no blank line before code fence
- Line 7 — code-fence — no blank line after code fence
- Line 1 — heading-format — no blank line after heading
- Line 2 — heading-format — no blank line before heading
- Line 2 — heading-format — no blank line after heading
- Line 7 — heading-format — no blank line before heading
- Line 3 — links — bare URL: https://example.com

### `good.md`

**Result:** PASS

Good practices followed:

- Single H1 title on the first line
- Heading levels increase one at a time with no duplicate headings
- ATX headings with a space after `#`, blank lines around them, no trailing punctuation
- Consistent bullet markers, 2-space nesting and sequential numbering; lists separated from text by blank lines
- Fenced code blocks are closed, tagged with a language and surrounded by blank lines
- No trailing spaces, tabs or repeated blank lines; ends with a single newline
- Consistent line endings
- No leftover TODO/TBD/FIXME placeholders
~~~
