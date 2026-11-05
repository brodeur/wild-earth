#!/usr/bin/env python3
"""Token meter: what Claude Code sessions spent on this project, in tokens and API-equivalent dollars.

It reads the transcripts Claude Code keeps under ~/.claude/projects/<project slug>/: one <session>.jsonl per session,
and <session>/subagents/*.jsonl for the agents it started. Every assistant record carries the request's `usage`
(input, output with thinking, cache reads, cache writes split into 5-minute and 1-hour). A request is streamed as
several records with the same requestId, so they are counted once; a forked session's transcript begins with a copy
of its parent's, and those copied requests count only for the parent.

Prices are the Anthropic first-party API rates per million tokens (the claude-api skill's table, cached 2026-10-06),
with cache writes at 1.25x input for 5 minutes and 2x for 1 hour. On a subscription plan this is what the same work
would cost on the API, not a bill. It matches Claude Code's own `cost-state` record within a few percent.

  tools/token_meter.py                                  every session of this checkout, a line each
  tools/token_meter.py --session 4bce79f6               one session (a transcript id or its prefix), with its agents
  tools/token_meter.py --since 2026-11-04T18:00 --until now --worktrees
                                                        a time window across the main checkout and every worktree
  tools/token_meter.py --session 4bce79f6 --since 2h --json
                                                        the last two hours of one session as JSON (tile cost records)

Times are ISO (local time unless a zone is given) or a span back from now: 90m, 2h, 3d. Standard library only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECTS = Path.home() / ".claude" / "projects"
# $ per million tokens: input, output (thinking included), cache read
PRICES = {
    "claude-fable-5-1": (10.0, 50.0, 0.25),
    "claude-fable-5": (10.0, 50.0, 1.0),
    "claude-opus-5-5": (4.0, 20.0, 0.20),
    "claude-opus-5": (5.0, 25.0, 0.50),
    "claude-opus-4-8": (5.0, 25.0, 0.50),
    "claude-sonnet-5-5": (2.0, 10.0, 0.20),
    "claude-sonnet-5": (2.0, 10.0, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
}
W5, W1 = 1.25, 2.0   # cache write multipliers on input: 5-minute, 1-hour


def slug(path: Path) -> str:
    return re.sub(r"[^A-Za-z0-9]", "-", str(path.resolve()))


def when(s: str | None, default: datetime | None) -> datetime | None:
    if not s:
        return default
    if s == "now":
        return datetime.now(timezone.utc)
    m = re.fullmatch(r"(\d+(?:\.\d+)?)([mhd])", s)
    if m:
        return datetime.now(timezone.utc) - timedelta(**{{"m": "minutes", "h": "hours", "d": "days"}[m[2]]: float(m[1])})
    t = datetime.fromisoformat(s)
    return t if t.tzinfo else t.astimezone()


def transcripts(project_dirs: list[Path], session: str | None):
    """(session id, [files]) per session: the main transcript and its subagents."""
    for d in project_dirs:
        for f in sorted(d.glob("*.jsonl")):
            sid = f.stem
            if session and not sid.startswith(session):
                continue
            yield d, sid, [f] + sorted((d / sid / "subagents").glob("*.jsonl"))


def requests(files: list[Path], t0: datetime | None, t1: datetime | None) -> tuple[dict, str | None]:
    """{requestId: (model, usage, time, by an agent)} and the session's first prompt."""
    reqs: dict[str, tuple] = {}
    first_prompt = None
    for f in files:
        with open(f, errors="replace") as fh:
            for line in fh:
                if first_prompt is None and f is files[0] and '"type":"user"' in line.replace(" ", ""):
                    try:
                        d = json.loads(line)
                        c = d.get("message", {}).get("content")
                        txt = c if isinstance(c, str) else next((b.get("text") for b in c or [] if isinstance(b, dict) and b.get("type") == "text"), None)
                        if txt and not txt.startswith("<"):
                            first_prompt = " ".join(txt.split())[:90]
                    except (ValueError, AttributeError):
                        pass
                if '"usage"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if d.get("type") != "assistant":
                    continue
                ts = datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00"))
                if (t0 and ts < t0) or (t1 and ts > t1):
                    continue
                m = d["message"]
                reqs[d.get("requestId") or m.get("id") or f"{f}:{ts}"] = (m.get("model"), m.get("usage") or {}, ts, f is not files[0])
    return reqs, first_prompt


def meter(reqs: dict, first_prompt: str | None) -> dict:
    out = {"requests": len(reqs), "agent_requests": 0, "first": None, "last": None, "models": {}, "usd": 0.0,
           "unpriced": [], "first_prompt": first_prompt}
    for model, u, ts, sub in reqs.values():
        out["agent_requests"] += sub
        out["first"] = min(out["first"] or ts, ts)
        out["last"] = max(out["last"] or ts, ts)
        cc = u.get("cache_creation") or {}
        w5 = cc.get("ephemeral_5m_input_tokens", 0) if cc else u.get("cache_creation_input_tokens", 0)
        w1 = cc.get("ephemeral_1h_input_tokens", 0)
        row = out["models"].setdefault(model, {"input": 0, "output": 0, "thinking": 0, "cache_read": 0, "cache_write": 0, "usd": 0.0})
        row["input"] += u.get("input_tokens", 0)
        row["output"] += u.get("output_tokens", 0)
        row["thinking"] += (u.get("output_tokens_details") or {}).get("thinking_tokens", 0)
        row["cache_read"] += u.get("cache_read_input_tokens", 0)
        row["cache_write"] += w5 + w1
        p = PRICES.get(model)
        if p is None:
            if model and model not in out["unpriced"] and model != "<synthetic>":
                out["unpriced"].append(model)
            continue
        i, o, cr = p
        usd = (u.get("input_tokens", 0) * i + u.get("output_tokens", 0) * o + u.get("cache_read_input_tokens", 0) * cr
               + w5 * i * W5 + w1 * i * W1) / 1e6
        row["usd"] += usd
        out["usd"] += usd
    for k in ("first", "last"):
        out[k] = out[k].isoformat() if out[k] else None
    return out


def mtok(n: int) -> str:
    return f"{n / 1e6:,.1f}M" if n >= 1e5 else f"{n / 1e3:,.0f}k"


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", type=Path, default=Path.cwd(), help="checkout or worktree path (default: here)")
    ap.add_argument("--worktrees", action="store_true", help="also every .claude/worktrees/* of the project")
    ap.add_argument("--session", help="a transcript id or its prefix")
    ap.add_argument("--since")
    ap.add_argument("--until")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    t0, t1 = when(a.since, None), when(a.until, None)
    base = slug(a.project)
    dirs = [PROJECTS / base] + (sorted(PROJECTS.glob(base + "--claude-worktrees-*")) if a.worktrees else [])
    dirs = [d for d in dirs if d.is_dir()]
    if not dirs:
        sys.exit(f"no transcripts for {a.project} under {PROJECTS}")
    # A forked session's transcript starts with a copy of its parent's, so a request is counted once, for the
    # session whose transcript was created first (the parent).
    found = sorted(transcripts(dirs, a.session), key=lambda x: getattr(x[2][0].stat(), "st_birthtime", x[2][0].stat().st_mtime))
    seen: set[str] = set()
    rows = []
    for d, sid, files in found:
        reqs, prompt = requests(files, t0, t1)
        reqs = {k: v for k, v in reqs.items() if k not in seen}
        seen.update(reqs)
        r = meter(reqs, prompt)
        if r["requests"]:
            r.update(session=sid, where=d.name[len(base):].lstrip("-").replace("claude-worktrees-", "") or "main")
            rows.append(r)
    total = {"usd": sum(r["usd"] for r in rows), "requests": sum(r["requests"] for r in rows), "models": {}}
    for r in rows:
        for m, v in r["models"].items():
            t = total["models"].setdefault(m, dict.fromkeys(v, 0))
            for k in v:
                t[k] += v[k]
    if a.json:
        print(json.dumps({"since": t0 and t0.isoformat(), "until": t1 and t1.isoformat(), "sessions": rows, "total": total}, indent=1, default=str))
        return
    rows.sort(key=lambda r: r["first"] or "")
    for r in rows:
        print(f"{r['first'][:16]}  {r['session'][:8]}  {r['where'][:28]:28}  ${r['usd']:9,.2f}  {r['requests']:6} req"
              f" ({r['agent_requests']} by agents)  {r['first_prompt'] or ''}")
    print(f"\n{'model':20} {'input':>8} {'output':>8} {'thinking':>9} {'cache rd':>9} {'cache wr':>9} {'$':>11}")
    for m, v in sorted(total["models"].items(), key=lambda kv: -kv[1]["usd"]):
        print(f"{str(m):20} {mtok(v['input']):>8} {mtok(v['output']):>8} {mtok(v['thinking']):>9} {mtok(v['cache_read']):>9}"
              f" {mtok(v['cache_write']):>9} {v['usd']:>11,.2f}")
    print(f"{'total':20} {'':>47} ${total['usd']:>10,.2f}  ({total['requests']} requests, {len(rows)} sessions)")
    unp = sorted({m for r in rows for m in r["unpriced"]})
    if unp:
        print("not priced (add to PRICES):", ", ".join(unp))


if __name__ == "__main__":
    main()
