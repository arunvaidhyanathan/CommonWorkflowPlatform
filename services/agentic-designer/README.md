# Agentic Designer

LLM-assisted workflow authoring for CWP. Design and phase status:
[`Documents/AgenticDesigner.html`](../../Documents/AgenticDesigner.html).

The rule: **the model proposes, code decides.** The model only ever returns
a `WorkflowGraph` (Generate) or a list of patch ops (Edit); this package
validates them before anything reaches the Designer canvas, and saving
always goes through the SPA's normal draft and approval flow.

## Status

Phase A0 (contract, no LLM, no HTTP yet):

| Module | What it is |
|---|---|
| `graph.py` | `WorkflowGraph` / `Node` / `Edge`: the typed contract the model must produce. camelCase JSON, unknown fields rejected |
| `patch.py` | Edit ops (`add_node`, `update_node`, `remove_node`, `connect`, `disconnect`, `set_condition`) and `apply_patch` |
| `validator.py` | Structural rules `AD001`–`AD016` (errors block, warnings don't) |
| `canvas.py` | `to_canvas` / `from_canvas`: conversion to the SPA's `GraphSnapshot` |

## Develop

```
uv sync
uv run pytest
```
