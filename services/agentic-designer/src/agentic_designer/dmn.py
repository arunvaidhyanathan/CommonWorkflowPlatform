"""DMN decision-table contract, validator and conversion (AgenticDesigner.html
phase A4).

Mirrors the Designer's DMN model (Designer/src/adapters/dmnAdapter.ts):
standalone decision tables, no decision requirements graph. Conventions
follow the Designer's sample (Designer/samples/investigation-decisions.dmn):
string literals are quoted ("Trading"), "-" means any value, and entries
are FEEL unary tests (">= 3", "< 3", "[1..5]").
"""

import re
from typing import Any, Literal

from pydantic import Field, ValidationError

from .canvas import CanvasConversionError
from .graph import ID_PATTERN, _Model
from .validator import Issue

TypeRef = Literal["string", "number", "integer", "long", "double", "boolean", "date"]
HitPolicy = Literal["UNIQUE", "FIRST", "PRIORITY", "ANY", "COLLECT", "RULE ORDER", "OUTPUT ORDER"]
Aggregation = Literal["SUM", "COUNT", "MIN", "MAX"]
NUMERIC_TYPES = frozenset({"number", "integer", "long", "double"})


class DmnInput(_Model):
    id: str = Field(pattern=ID_PATTERN)
    label: str = Field(min_length=1)
    expression: str  # the variable or FEEL expression the column tests, e.g. "priorIncidentCount"
    type_ref: TypeRef


class DmnOutput(_Model):
    id: str = Field(pattern=ID_PATTERN)
    name: str = Field(min_length=1)  # the result variable, e.g. "riskPoints"
    type_ref: TypeRef


class DmnRule(_Model):
    id: str = Field(pattern=ID_PATTERN)
    input_entries: tuple[str, ...]  # one per input, in order
    output_entries: tuple[str, ...]  # one per output, in order


class Decision(_Model):
    id: str = Field(pattern=ID_PATTERN)
    name: str = Field(min_length=1)
    hit_policy: HitPolicy
    aggregation: Aggregation | None = None  # COLLECT only
    inputs: tuple[DmnInput, ...]
    outputs: tuple[DmnOutput, ...]
    rules: tuple[DmnRule, ...]


class DecisionModel(_Model):
    decisions: tuple[Decision, ...] = ()

    def decision(self, decision_id: str) -> Decision | None:
        return next((d for d in self.decisions if d.id == decision_id), None)


_NUMBER = re.compile(r"^-?\d+(\.\d+)?$")


def _fits_type(entry: str, type_ref: str) -> bool:
    """Is an output entry a literal of its column's type? (A FEEL expression
    can also be valid, so a mismatch is only a warning.)"""
    value = entry.strip()
    if type_ref in NUMERIC_TYPES:
        return bool(_NUMBER.match(value))
    if type_ref == "boolean":
        return value in ("true", "false")
    if type_ref == "string":
        return len(value) >= 2 and value.startswith('"') and value.endswith('"')
    return True


def _normalized(entries: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(" ".join(e.split()) for e in entries)


def validate_decisions(model: DecisionModel) -> list[Issue]:
    """Structural rules DM001-DM011. Errors block, warnings don't. Issue ids
    name decisions, rules and columns (reported as node ids)."""
    issues: list[Issue] = []

    def err(code, message, ids=()):
        issues.append(Issue(code, "error", message, tuple(ids)))

    def warn(code, message, ids=()):
        issues.append(Issue(code, "warning", message, tuple(ids)))

    if not model.decisions:
        err("DM002", "The model has no decisions.")

    seen: set[str] = set()
    for d in model.decisions:
        for item_id in [d.id] + [c.id for c in d.inputs] + [c.id for c in d.outputs] + [r.id for r in d.rules]:
            if item_id in seen:
                err("DM001", f"Duplicate id '{item_id}'.", [item_id])
            seen.add(item_id)

        if not d.inputs or not d.outputs:
            err("DM003", f"Decision '{d.name}' needs at least one input and one output.", [d.id])
            continue
        if d.aggregation is not None and d.hit_policy != "COLLECT":
            err("DM005", f"Decision '{d.name}': aggregation {d.aggregation} only applies to the COLLECT hit policy.", [d.id])
        for c in d.inputs:
            if not c.expression.strip():
                err("DM007", f"Input '{c.label}' in '{d.name}' has no expression to test.", [d.id, c.id])
        names = [o.name for o in d.outputs]
        for dup in sorted({n for n in names if names.count(n) > 1}):
            err("DM008", f"Decision '{d.name}' has two outputs named '{dup}'.", [d.id])
        if not d.rules:
            warn("DM011", f"Decision '{d.name}' has no rules, so it never produces a result.", [d.id])

        rows: dict[tuple[str, ...], str] = {}
        for r in d.rules:
            if len(r.input_entries) != len(d.inputs) or len(r.output_entries) != len(d.outputs):
                err("DM004", f"Rule '{r.id}' in '{d.name}' has {len(r.input_entries)} input and {len(r.output_entries)} "
                             f"output entries; the table has {len(d.inputs)} inputs and {len(d.outputs)} outputs.", [d.id, r.id])
                continue
            for entry in r.input_entries:
                if not entry.strip():
                    err("DM012", f"Rule '{r.id}' in '{d.name}' has an empty input entry; use - for any value.", [d.id, r.id])
                    break
            for entry, out in zip(r.output_entries, d.outputs):
                if not entry.strip():
                    err("DM006", f"Rule '{r.id}' in '{d.name}' has no value for output '{out.name}'.", [d.id, r.id])
                elif not _fits_type(entry, out.type_ref):
                    warn("DM010", f"Rule '{r.id}' in '{d.name}': output '{out.name}' is {out.type_ref} but the entry is "
                                  f"{entry.strip()}" + (' (strings are quoted, e.g. "High")' if out.type_ref == "string" else "") + ".",
                         [d.id, r.id])
            # DM009: with UNIQUE, two rules with identical inputs always match together.
            key = _normalized(r.input_entries)
            if d.hit_policy == "UNIQUE" and key in rows:
                err("DM009", f"Rules '{rows[key]}' and '{r.id}' in '{d.name}' test exactly the same inputs, which UNIQUE forbids.",
                    [d.id, rows[key], r.id])
            rows.setdefault(key, r.id)
    return issues


# --- conversion to and from the Designer's DmnModel -------------------------------------

def to_dmn_model(model: DecisionModel, template: dict[str, Any] | None = None) -> dict[str, Any]:
    """The SPA's DmnModel shape. ``template`` is the current DmnModel when
    editing: its definitions metadata and decision-table ids are kept."""
    template = template or {}
    table_ids = {d.get("id"): (d.get("decisionTable") or {}).get("id") for d in template.get("decisions", [])}
    decisions = []
    for d in model.decisions:
        table: dict[str, Any] = {
            "id": table_ids.get(d.id) or f"{d.id}_table",
            "hitPolicy": d.hit_policy,
            "inputs": [{"id": c.id, "label": c.label, "expression": c.expression, "typeRef": c.type_ref} for c in d.inputs],
            "outputs": [{"id": c.id, "name": c.name, "typeRef": c.type_ref} for c in d.outputs],
            "rules": [{"id": r.id, "inputEntries": list(r.input_entries), "outputEntries": list(r.output_entries)} for r in d.rules],
        }
        if d.aggregation is not None:
            table["aggregation"] = d.aggregation
        decisions.append({"id": d.id, "name": d.name, "decisionTable": table})
    return {
        "definitionsId": template.get("definitionsId", ""),
        "definitionsName": template.get("definitionsName", ""),
        "namespace": template.get("namespace", ""),
        "decisions": decisions,
    }


def from_dmn_model(dmn_model: dict[str, Any]) -> DecisionModel:
    try:
        decisions = []
        for d in dmn_model.get("decisions", []):
            t = d["decisionTable"]
            decisions.append(Decision.model_validate({
                "id": d["id"], "name": d["name"], "hitPolicy": t["hitPolicy"], "aggregation": t.get("aggregation"),
                "inputs": [{"id": c["id"], "label": c["label"], "expression": c["expression"], "typeRef": c["typeRef"]} for c in t["inputs"]],
                "outputs": [{"id": c["id"], "name": c["name"], "typeRef": c["typeRef"]} for c in t["outputs"]],
                "rules": [{"id": r["id"], "inputEntries": r["inputEntries"], "outputEntries": r["outputEntries"]} for r in t["rules"]],
            }))
    except (ValidationError, KeyError, TypeError) as exc:
        raise CanvasConversionError(f"decision model is not supported by the agent: {exc}") from exc
    return DecisionModel(decisions=tuple(decisions))
