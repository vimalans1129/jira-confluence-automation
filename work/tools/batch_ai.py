"""Run an AI instruction over every file matching a glob and save each result.

Usage:
    python tools/batch_ai.py "modules/**/walkthrough.md" -i "Check for a Summary and a Quiz section; list what is missing." -o out

Environment:
    OPENAI_API_KEY   required
    OPENAI_BASE_URL  optional (default https://api.openai.com/v1)
    OPENAI_MODEL     optional (default gpt-4o-mini)
"""
import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path


def call_ai(instruction: str, content: str) -> str:
    base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    payload = {
        "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        "messages": [
            {"role": "system", "content": instruction},
            {"role": "user", "content": content},
        ],
    }
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)["choices"][0]["message"]["content"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pattern", help="glob pattern relative to --root, e.g. 'modules/**/walkthrough.md'")
    parser.add_argument("-i", "--instruction", required=True, help="instruction text, or path to a file containing it")
    parser.add_argument("-o", "--output-dir", default="ai_output", help="where results are saved")
    parser.add_argument("--root", default=".", help="base directory for the glob")
    args = parser.parse_args()

    if "OPENAI_API_KEY" not in os.environ:
        print("OPENAI_API_KEY is not set", file=sys.stderr)
        return 1

    instruction = args.instruction
    if Path(instruction).is_file():
        instruction = Path(instruction).read_text(encoding="utf-8")

    root = Path(args.root).resolve()
    out_dir = Path(args.output_dir).resolve()
    files = sorted(p for p in root.glob(args.pattern) if p.is_file() and out_dir not in p.parents)

    print(f"Found {len(files)} file(s):")
    for f in files:
        print(f"  {f.relative_to(root)}")

    failures = 0
    for f in files:
        rel = f.relative_to(root)
        out_file = out_dir / rel.with_name(rel.name + ".result.md")
        try:
            result = call_ai(instruction, f.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"FAILED {rel}: {exc}", file=sys.stderr)
            failures += 1
            continue
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_text(result, encoding="utf-8")
        print(f"Saved {out_file}")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
