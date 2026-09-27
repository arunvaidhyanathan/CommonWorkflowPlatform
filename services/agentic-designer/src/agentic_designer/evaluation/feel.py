"""Just enough FEEL to execute simple decision tables in evaluations.

Supports the unary tests the Designer's tables use: "-" (any), literals
("Trading", 25, true), comparisons (>= 3, < 0.35), ranges ([650..749],
(0.35..0.45], ]1..5[), comma lists ("A","B"), and not(...). Anything else
raises Unsupported, so an evaluation reports "can't evaluate" instead of
guessing. Hit policies: UNIQUE, FIRST, ANY, PRIORITY (by rule order, since
the contract has no output value lists), RULE ORDER, OUTPUT ORDER, COLLECT
with or without SUM, COUNT, MIN, MAX.
"""

import re
from typing import Any

from ..dmn import Decision


class Unsupported(ValueError):
    pass


class HitPolicyViolation(ValueError):
    pass


_NUM = r"-?\d+(?:\.\d+)?"
_RANGE = re.compile(rf"^([\[\(\]])\s*({_NUM})\s*\.\.\s*({_NUM})\s*([\]\)\[])$")
_CMP = re.compile(rf"^(<=|>=|<|>|=)\s*({_NUM})$")


def literal(text: str) -> Any:
    t = text.strip()
    if len(t) >= 2 and t.startswith('"') and t.endswith('"'):
        return t[1:-1]
    if t in ("true", "false"):
        return t == "true"
    if re.fullmatch(_NUM, t):
        return float(t) if "." in t else int(t)
    raise Unsupported(f"not a literal: {text!r}")


def _split_list(text: str) -> list[str]:
    parts, depth, quoted, cur = [], 0, False, ""
    for ch in text:
        if ch == '"':
            quoted = not quoted
        elif not quoted and ch in "[(":
            depth += 1
        elif not quoted and ch in "])":
            depth -= 1
        if ch == "," and depth == 0 and not quoted:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return [p.strip() for p in parts]


def matches(test: str, value: Any) -> bool:
    t = test.strip()
    if t in ("-", ""):
        return True
    if t.startswith("not(") and t.endswith(")"):
        return not matches(t[4:-1], value)
    parts = _split_list(t)
    if len(parts) > 1:
        return any(matches(p, value) for p in parts)
    if m := _RANGE.match(t):
        if not _num(value):
            return False
        lo, hi = float(m.group(2)), float(m.group(3))
        lo_ok = value >= lo if m.group(1) == "[" else value > lo
        hi_ok = value <= hi if m.group(4) == "]" else value < hi
        return lo_ok and hi_ok
    if m := _CMP.match(t):
        if not _num(value):
            return False
        n = float(m.group(2))
        return {"<": value < n, "<=": value <= n, ">": value > n, ">=": value >= n, "=": value == n}[m.group(1)]
    return value == literal(t)


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def evaluate(decision: Decision, inputs: dict[str, Any]) -> Any:
    """Run one decision on named inputs (keyed by each input's expression).
    Returns a dict of outputs (single-hit), a list of dicts (multi-hit), an
    aggregated number (COLLECT with aggregation), or None when no rule matches."""
    missing = [c.expression for c in decision.inputs if c.expression not in inputs]
    if missing:
        raise Unsupported(f"no value for input(s) {missing}")
    hits = []
    for rule in decision.rules:
        if all(matches(test, inputs[c.expression]) for test, c in zip(rule.input_entries, decision.inputs)):
            hits.append({o.name: literal(e) for e, o in zip(rule.output_entries, decision.outputs)})
    policy = decision.hit_policy
    if policy in ("UNIQUE", "ANY", "FIRST", "PRIORITY"):
        if not hits:
            return None
        if policy == "UNIQUE" and len(hits) > 1:
            raise HitPolicyViolation(f"{len(hits)} rules matched under UNIQUE")
        if policy == "ANY" and any(h != hits[0] for h in hits):
            raise HitPolicyViolation("rules matched with different outputs under ANY")
        return hits[0]
    if policy in ("RULE ORDER", "OUTPUT ORDER"):
        return hits
    # COLLECT
    if decision.aggregation is None:
        return hits
    if decision.aggregation == "COUNT":
        return len(hits)
    values = [next(iter(h.values())) for h in hits]
    if not values:
        return None
    return {"SUM": sum, "MIN": min, "MAX": max}[decision.aggregation](values)
