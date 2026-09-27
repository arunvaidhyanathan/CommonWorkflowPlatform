"""The canvas converter is the contract with the Designer SPA.

Shapes here mirror what Designer/src/adapters/bpmnAdapter.ts#parseBpmnXml
produces and what workflow_versions.graph_json stores.
"""

import pytest

from agentic_designer.canvas import CanvasConversionError, from_canvas, to_canvas
from fixtures import loan_approval


def test_round_trip_preserves_the_graph():
    g = loan_approval()
    assert from_canvas(to_canvas(g)) == g


def test_all_nodes_share_one_position_so_the_spa_auto_layouts():
    # needsAutoLayout (autoLayout.ts) returns true only when every node has
    # the same position; that is what makes an agent graph get laid out.
    nodes = to_canvas(loan_approval())["nodes"]
    assert len(nodes) >= 2
    assert len({(n["position"]["x"], n["position"]["y"]) for n in nodes}) == 1


def test_node_and_edge_shape_matches_the_bpmn_adapter():
    canvas = to_canvas(loan_approval())
    review = next(n for n in canvas["nodes"] if n["id"] == "review")
    assert review["type"] == "userTask"
    assert review["data"] == {"label": "Review application", "candidateGroups": ["underwriters"]}

    f3 = next(e for e in canvas["edges"] if e["id"] == "f3")
    assert f3["type"] == "smoothstep"
    assert f3["data"] == {"conditionExpression": "${amount > 10000}"}
    assert f3["label"] == "yes"


def test_reading_the_canvas_ignores_layout_and_ui_state():
    canvas = to_canvas(loan_approval())
    for n in canvas["nodes"]:
        n["position"] = {"x": 123, "y": 456}
        n["selected"] = True
        n["measured"] = {"width": 100, "height": 60}
    assert from_canvas(canvas) == loan_approval()


def test_unsupported_node_types_fail_loudly():
    # Dropping a boundary event silently would make an Edit delete it.
    canvas = to_canvas(loan_approval())
    canvas["nodes"].append({"id": "timer", "type": "boundaryEvent", "position": {"x": 0, "y": 0}, "data": {"label": "t"}})
    with pytest.raises(CanvasConversionError):
        from_canvas(canvas)


def test_edge_without_data_reads_as_unconditioned():
    canvas = {
        "nodes": [
            {"id": "s", "type": "startEvent", "position": {"x": 0, "y": 0}, "data": {"label": ""}},
            {"id": "e", "type": "endEvent", "position": {"x": 0, "y": 0}, "data": {"label": ""}},
        ],
        "edges": [{"id": "f", "source": "s", "target": "e"}],
    }
    g = from_canvas(canvas)
    assert g.edge("f").condition_expression is None
    assert g.edge("f").label == ""
