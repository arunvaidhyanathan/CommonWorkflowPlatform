"""Seeded-defect workflows for Review mode (A3's completion criterion: every
seeded defect is reported). Each sample plants one defect in the valid loan
process and says which finding should catch it: a code check (exact AD
code) or an AI judgement (category, and a node it should point at).

Used by tests/test_review.py (check defects, deterministic) and by
scripts/review_eval.py (AI defects, against a live model)."""

from agentic_designer.graph import Edge, Node, WorkflowGraph
from fixtures import loan_approval, with_changes

g = loan_approval()


def _linear(*steps: tuple[str, str, str]) -> WorkflowGraph:
    """start -> steps... -> end, each step (id, type, label), user tasks assigned."""
    nodes = [Node(id="start", type="startEvent", label="Start")]
    for sid, stype, label in steps:
        extra = {"candidate_groups": ("ops",)} if stype == "userTask" else {}
        nodes.append(Node(id=sid, type=stype, label=label, **extra))
    nodes.append(Node(id="end", type="endEvent", label="End"))
    edges = [Edge(id=f"f{i}", source=a.id, target=b.id) for i, (a, b) in enumerate(zip(nodes, nodes[1:]), 1)]
    return WorkflowGraph(nodes=tuple(nodes), edges=tuple(edges))


SAMPLES = {
    # --- found by code checks -----------------------------------------------------------
    "unassigned_task": {
        "graph": with_changes(g, replace_nodes=[Node(id="manager", type="userTask", label="Manager approval")]),
        "expect": {"source": "check", "code": "AD017", "node": "manager"},
    },
    "dead_end": {
        "graph": with_changes(
            g,
            add_nodes=[Node(id="hold", type="userTask", label="Put on hold", candidate_groups=("ops",))],
            add_edges=[Edge(id="f_hold", source="amount_check", target="hold", condition_expression="${risk == 'high'}")],
        ),
        "expect": {"source": "check", "code": "AD010", "node": "hold"},
    },
    # --- need judgement (AI) -------------------------------------------------------------
    "no_rejection_path": {
        # The manager "approves", but nothing happens if they say no.
        "graph": _linear(
            ("review", "userTask", "Review application"),
            ("approve", "userTask", "Manager approves the loan"),
            ("disburse", "serviceTask", "Disburse funds"),
        ),
        "expect": {"source": "ai", "category": "missing_path", "node": "approve"},
    },
    "overlapping_conditions": {
        "graph": with_changes(
            g,
            replace_edges=[
                Edge(id="f3", source="amount_check", target="manager", label="large", condition_expression="${amount > 1000}"),
                Edge(id="f4", source="amount_check", target="merge", label="very large", condition_expression="${amount > 5000}"),
            ],
        ),
        "expect": {"source": "ai", "category": "overlapping_conditions", "node": "amount_check"},
    },
    "unclear_label": {
        "graph": with_changes(g, replace_nodes=[Node(id="review", type="userTask", label="Do step 2", candidate_groups=("underwriters",))]),
        "expect": {"source": "ai", "category": "unclear_label", "node": "review"},
    },
    "wrong_order": {
        # Money goes out before anyone approves it.
        "graph": _linear(
            ("disburse", "serviceTask", "Disburse funds"),
            ("review", "userTask", "Review application"),
            ("approve", "userTask", "Manager approval"),
        ),
        "expect": {"source": "ai", "category": "ordering", "node": "disburse"},
    },
}


def caught(findings, expect) -> bool:
    """Did any finding catch the seeded defect? For AI findings the category
    must match and the finding must point at the defect's node (or name it)."""
    for f in findings:
        if f.source != expect["source"]:
            continue
        if expect["source"] == "check":
            if f.code == expect["code"] and expect["node"] in f.node_ids:
                return True
        elif f.code == expect["category"] and (expect["node"] in f.node_ids or not f.node_ids):
            return True
    return False
