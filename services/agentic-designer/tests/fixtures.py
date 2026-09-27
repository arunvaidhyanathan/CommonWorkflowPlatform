"""Graph fixtures shared by the tests.

``loan_approval()`` is a small, fully valid process. Each ``broken_*``
fixture changes it in exactly one way, so a test can assert that the
validator reports that one problem and nothing else.
"""

from agentic_designer.graph import Edge, Node, WorkflowGraph


def loan_approval() -> WorkflowGraph:
    return WorkflowGraph(
        nodes=(
            Node(id="start", type="startEvent", label="Application received"),
            Node(id="review", type="userTask", label="Review application", candidate_groups=("underwriters",)),
            Node(id="amount_check", type="exclusiveGateway", label="Amount over 10k?"),
            Node(id="manager", type="userTask", label="Manager approval", assignee="${manager}"),
            Node(id="merge", type="exclusiveGateway"),
            Node(id="disburse", type="serviceTask", label="Disburse funds", delegate_expression="${disburseDelegate}"),
            Node(id="end", type="endEvent", label="Done"),
        ),
        edges=(
            Edge(id="f1", source="start", target="review"),
            Edge(id="f2", source="review", target="amount_check"),
            Edge(id="f3", source="amount_check", target="manager", label="yes", condition_expression="${amount > 10000}"),
            Edge(id="f4", source="amount_check", target="merge", label="no"),
            Edge(id="f5", source="manager", target="merge"),
            Edge(id="f6", source="merge", target="disburse"),
            Edge(id="f7", source="disburse", target="end"),
        ),
    )


def with_changes(
    graph: WorkflowGraph,
    add_nodes=(),
    add_edges=(),
    drop_nodes=(),
    drop_edges=(),
    replace_nodes=(),
    replace_edges=(),
) -> WorkflowGraph:
    replaced_n = {n.id: n for n in replace_nodes}
    replaced_e = {e.id: e for e in replace_edges}
    nodes = [replaced_n.get(n.id, n) for n in graph.nodes if n.id not in drop_nodes]
    edges = [replaced_e.get(e.id, e) for e in graph.edges if e.id not in drop_edges]
    return WorkflowGraph(nodes=tuple(nodes) + tuple(add_nodes), edges=tuple(edges) + tuple(add_edges))


g = loan_approval()

# expected error code -> graph that should trigger exactly that error
BROKEN = {
    "AD001": with_changes(g, add_nodes=[Node(id="review", type="userTask", label="Duplicate review")]),
    "AD002": with_changes(g, add_edges=[Edge(id="f_ghost", source="review", target="ghost")]),
    "AD003": with_changes(g, add_edges=[Edge(id="f_self", source="review", target="review")]),
    "AD004": with_changes(g, drop_nodes=["start"], drop_edges=["f1"]),
    "AD005": with_changes(
        g,
        add_nodes=[Node(id="start2", type="startEvent", label="Second start")],
        add_edges=[Edge(id="f_s2", source="start2", target="review")],
    ),
    "AD006": with_changes(g, drop_nodes=["end"], drop_edges=["f7"]),
    "AD007": with_changes(g, add_edges=[Edge(id="f_back", source="review", target="start")]),
    "AD008": with_changes(g, add_edges=[Edge(id="f_after_end", source="end", target="disburse")]),
    "AD009": with_changes(
        g,
        add_nodes=[Node(id="audit", type="userTask", label="Orphan audit")],
        add_edges=[Edge(id="f_audit", source="audit", target="end")],
    ),
    "AD010": with_changes(
        g,
        add_nodes=[Node(id="hold", type="userTask", label="Put on hold")],
        add_edges=[Edge(id="f_hold", source="amount_check", target="hold", condition_expression="${risk == 'high'}")],
    ),
    "AD011": with_changes(g, replace_edges=[Edge(id="f3", source="amount_check", target="manager", label="yes")]),
    "AD014": with_changes(
        g,
        replace_nodes=[
            Node(id="disburse", type="serviceTask", label="Disburse funds", delegate_expression="${d}", assignee="alice")
        ],
    ),
}

# expected warning code -> graph that should trigger it without any error
WARNINGS = {
    "AD012": with_changes(
        g,
        drop_edges=["f2", "f3", "f4"],
        replace_nodes=[Node(id="amount_check", type="parallelGateway", label="Split")],
        add_edges=[
            Edge(id="f2", source="review", target="amount_check"),
            Edge(id="f3", source="amount_check", target="manager", condition_expression="${x}"),
            Edge(id="f4", source="amount_check", target="merge"),
        ],
    ),
    "AD013": with_changes(g, add_edges=[Edge(id="f_skip", source="review", target="merge")]),
    "AD015": with_changes(g, replace_nodes=[Node(id="manager", type="userTask", assignee="${manager}")]),
    "AD016": with_changes(g, add_edges=[Edge(id="f7b", source="disburse", target="end")]),
}
