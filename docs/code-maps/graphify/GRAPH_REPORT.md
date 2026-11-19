# Graph Report - CommonWorkflowPlatform  (2026-11-18)

## Corpus Check
- 212 files · ~106,105 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1718 nodes · 3481 edges · 116 communities (74 shown, 42 thin omitted)
- Extraction: 81% EXTRACTED · 19% INFERRED · 0% AMBIGUOUS · INFERRED: 674 edges (avg confidence: 0.67)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 105|Community 105]]

## God Nodes (most connected - your core abstractions)
1. `apiFetch()` - 75 edges
2. `WorkflowGraph` - 31 edges
3. `Turn` - 28 edges
4. `LLMProvider` - 27 edges
5. `ProviderError` - 26 edges
6. `CanvasConversionError` - 24 edges
7. `useSession()` - 23 edges
8. `Issue` - 23 edges
9. `edit_workflow()` - 23 edges
10. `useWorkbenchStore` - 22 edges

## Surprising Connections (you probably didn't know these)
- `_event()` --calls--> `UsageEvent`  [INFERRED]
  services/agentic-designer/tests/test_usage.py → services/agentic-designer/src/agentic_designer/usage.py
- `test_review_expectation_matching()` --calls--> `Finding`  [INFERRED]
  services/agentic-designer/tests/test_evaluation.py → services/agentic-designer/src/agentic_designer/review.py
- `loan_approval()` --calls--> `WorkflowGraph`  [INFERRED]
  services/agentic-designer/tests/fixtures.py → services/agentic-designer/src/agentic_designer/graph.py
- `loadWorkflow()` --calls--> `apiFetch()`  [EXTRACTED]
  services/web-app/src/data/workflows.ts → services/web-app/src/lib/apiClient.ts
- `getDeployment()` --calls--> `apiFetch()`  [EXTRACTED]
  services/web-app/src/data/deployments.ts → services/web-app/src/lib/apiClient.ts

## Communities (116 total, 42 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (69): from_canvas(), Read the SPA's current canvas so the agent can edit or review it.      Canvas-on, to_canvas(), ScriptedProvider, caught(), _linear(), Seeded-defect workflows for Review mode (A3's completion criterion: every seeded, start -> steps... -> end, each step (id, type, label), user tasks assigned. (+61 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (67): Case, decides(), edit_cases(), gated_by_new_sentry(), generate_cases(), grounding_cases(), has_condition(), has_node() (+59 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (66): Diff, diff_json(), dmn_diff(), edit_event_payload(), edit_prompt(), edit_workflow(), EditEvent, _key() (+58 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (21): isTrue(), detectSpecType(), AutoCloseable, createDeployment(), DeploymentService, ScriptPolicy, ScriptPolicyTest, call() (+13 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (52): EXAMPLES, ExpressionTester(), AdHocWorkPanel(), MigrationPanel(), BusinessStatusField(), TimelinePanel(), WHAT_STYLE, BatchStatus (+44 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (49): bearer(), database_url(), event(), ingest(), Test fixtures: a throwaway Postgres in Docker, a local ES256 signer, and an app, Signer, admin(), _check() (+41 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (32): Example, examples_block(), ground(), GroundingStore, _hash(), index_missing(), Grounding in the tenant's own workflows (AgenticDesigner.html phase A5).  Before, The tenant's most similar workflows for ``query``; [] on any failure. (+24 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (25): DailyBarChart(), DailyPoint, PAD, acknowledgeAlert(), Budget, deleteBudget(), getBudgets(), getKeyStatus() (+17 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (27): Edge, _Model, Node, The typed workflow graph the model is allowed to produce.  Field names serialize, WorkflowGraph, AddNode, apply_patch(), Connect (+19 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (21): AppShell(), GOVERNANCE_NAV, NavItem, PRIMARY_NAV, RequireRole(), ApprovalRequest, decideApproval(), listPendingApprovals() (+13 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (25): GettingStartedPanel(), GettingStartedPanelProps, PublishBundlePicker(), IdentityResult, SPEC_OPTIONS, WorkflowIdentityDialog(), WorkflowIdentityDialogProps, dismissGettingStarted() (+17 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (26): archiveWorkflow(), createUser(), deleteWorkflowPermanently(), listTenantMembers(), setMemberGroups(), setMemberStatus(), setUserRole(), TenantMember (+18 more)

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (16): GenerateRequest, Embedder, GeminiEmbedder, MeteredEmbedder, NvidiaEmbedder, Text embeddings for grounding (AgenticDesigner.html phase A5).  Provider-agnosti, Vectors in input order, and the input tokens used., Records one usage event per embedding call (the spend tracker's     ``embed`` fe (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (23): attrOf(), CaseRole, CmmnNodeData, CmmnParseResult, createDefinition(), createItemControl(), DEFINITION_TO_NODE, expression() (+15 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (18): BpmnNodeData, AgentPanel(), BpmnProperties(), Canvas(), CmmnProperties(), CONTROLLABLE, PLAN_ITEM_TYPES, PropertiesPanel() (+10 more)

### Community 15 - "Community 15"
Cohesion: 0.14
Nodes (22): CmmnCasePlanNode, CmmnCaseTaskNode, CmmnDecisionTaskNode, CmmnHumanTaskNode, CmmnMilestoneNode, CmmnProcessTaskNode, CmmnSentryNode, CmmnStageNode (+14 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (4): Deployment, DeploymentRepository, from(), CaseInstanceController

### Community 17 - "Community 17"
Cohesion: 0.12
Nodes (15): Aggregation, DmnDecision, DmnDecisionService, DmnDecisionTable, DmnInputClause, DmnOutputClause, DmnRule, HitPolicy (+7 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (16): CaseInstance, listCaseInstances(), Deployment, EngineDeploymentRef, getDeployment(), listDeployments(), ManifestArtifact, HistoricTaskInstance (+8 more)

### Community 19 - "Community 19"
Cohesion: 0.17
Nodes (19): bodyOf(), BpmnEventDefinition, compact(), createElement(), DEFAULT_NODE_SIZE, EVENT_TYPES, eventDefinitions(), extensionElements() (+11 more)

### Community 20 - "Community 20"
Cohesion: 0.19
Nodes (18): CanvasConversionError, Decision, DecisionModel, DmnInput, DmnOutput, DmnRule, from_dmn_model(), _normalized() (+10 more)

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (11): MeteredProvider, Wraps an LLMProvider so each call is recorded, then returns or     re-raises exa, Cost in USD using the latest price in effect on ``on``, or None., _all_failed(), CaseResult, _Collect, Runs evaluation cases against one provider/model and summarizes them.  Every cas, review_caught() (+3 more)

### Community 23 - "Community 23"
Cohesion: 0.15
Nodes (13): GroundingNotice, First streamed event: which of the tenant's workflows are used as examples., Completion, _finish_reason(), GeminiProvider, OpenAICompatibleProvider, ProviderError, Provider-agnostic LLM layer.  One capability is needed: given a system instructi (+5 more)

### Community 24 - "Community 24"
Cohesion: 0.15
Nodes (13): create_app(), GroundingConfig, HTTP service. Reached through the edge gateway at /api/agent/** (nginx strips th, Yield each event from ``events``; yield None whenever ``every_s``     passes wit, Requests per tenant per minute, in process memory. Enough for one     replica; m, How to reach the tenant's workflows (as the user) and embed text., ReviewRequest, TenantRateLimiter (+5 more)

### Community 25 - "Community 25"
Cohesion: 0.26
Nodes (17): auth(), client_for(), HTTP layer: who may call /generate, and what the stream looks like., sse_events(), test_account_without_a_tenant_is_refused(), test_description_length_is_bounded(), test_designer_gets_a_streamed_canvas_graph(), test_expired_token_is_401() (+9 more)

### Community 26 - "Community 26"
Cohesion: 0.14
Nodes (12): _clean(), key_status(), list_alerts(), list_budgets(), Reads and writes for usage events and key checks., Latest check per key, plus what the last metered call through that     key did:, camelCase keys; Decimals as strings (exact); datetimes/dates as ISO., Each budget with this month's priced spend against it. (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.13
Nodes (13): applyAutoLayout(), DEFAULT_SIZE, elk, needsAutoLayout(), Canvas, EDIT_PLACEHOLDER, GENERATE_HELP, GENERATE_PLACEHOLDER (+5 more)

### Community 28 - "Community 28"
Cohesion: 0.17
Nodes (12): LoginForm(), API_BASE_URL, authHeader(), isApiConfigured(), login(), ServerSentEvent, current, getSession() (+4 more)

### Community 29 - "Community 29"
Cohesion: 0.18
Nodes (14): CaseEdge, CaseGraph, CaseNode, CMMN case contract, validator and canvas conversion (AgenticDesigner.html phase, Structural rules CD001-CD011. Same contract as the BPMN validator:     errors bl, validate_case(), case(), A valid small case: review -> (sentry) -> decide, plus a milestone gate. (+6 more)

### Community 31 - "Community 31"
Cohesion: 0.13
Nodes (9): FieldMapping, IoMapping, ACTIVITIES, CONTAINERS, EVENT_KINDS, EVENTS, IoFields(), ioToText() (+1 more)

### Community 32 - "Community 32"
Cohesion: 0.17
Nodes (15): run_key_checks(), check_key(), CheckResult, classify(), KeySpec, _money(), parse_openrouter_usage(), ProviderUsage (+7 more)

### Community 33 - "Community 33"
Cohesion: 0.18
Nodes (15): case_from_canvas(), case_to_canvas(), _fits_type(), Is an output entry a literal of its column's type? (A FEEL expression     can al, Structural rules DM001-DM011. Errors block, warnings don't. Issue ids     name d, validate_decisions(), CMMN and DMN contracts (A4), anchored on the Designer's real sample files (tests, test_dmn_issues_point_at_the_decision_and_rule() (+7 more)

### Community 34 - "Community 34"
Cohesion: 0.19
Nodes (3): JwksController, SigningKeysTest, getInstance()

### Community 37 - "Community 37"
Cohesion: 0.2
Nodes (11): errors(), loan_approval(), Graph fixtures shared by the tests.  ``loan_approval()`` is a small, fully valid, with_changes(), The validator is the gate between a model's proposal and the canvas.  A0's compl, test_a_single_fallback_branch_is_allowed(), test_each_broken_graph_is_rejected_for_exactly_its_reason(), test_empty_graph_reports_missing_start_and_end() (+3 more)

### Community 38 - "Community 38"
Cohesion: 0.16
Nodes (3): Clock, HttpIdentityDirectoryTest, MutableClock

### Community 41 - "Community 41"
Cohesion: 0.2
Nodes (3): ExpressionSandboxConfig, ReflectionBlockingResolver, ELResolver

### Community 42 - "Community 42"
Cohesion: 0.18
Nodes (9): parseBpmnXml(), body(), Els, eventDefinition(), m, moddle, o, original (+1 more)

### Community 43 - "Community 43"
Cohesion: 0.19
Nodes (12): AgentGraph, AgentIssue, CanvasGraph, EditEvent, editWorkflow(), GenerateEvent, generateWorkflow(), GroundingEvent (+4 more)

### Community 44 - "Community 44"
Cohesion: 0.22
Nodes (8): EditRequest, current_principal(), JwtVerifier, Principal, Login token verification, mirroring the Java services' SecurityConfig / TenantCo, Tokens are signed by identity-service with a key published in its JWKS., BaseModel, BudgetIn

### Community 45 - "Community 45"
Cohesion: 0.23
Nodes (3): HttpIdentityDirectory, Lookup, IdentityDirectory

### Community 48 - "Community 48"
Cohesion: 0.17
Nodes (10): CanvasSpec, describeChanges(), describeDmnChanges(), DmnDiff, EDGE_KEYS, EditDiff, mergeProposal(), NEW_NODE_OFFSET (+2 more)

### Community 49 - "Community 49"
Cohesion: 0.21
Nodes (5): current_viewer(), JwtVerifier, Who may see what (SpendTracker.html Section 3.5).  The same login-token check as, Login tokens are signed by identity-service with a key published in its JWKS., Viewer

### Community 52 - "Community 52"
Cohesion: 0.44
Nodes (10): as_json(), Generate mode's repair loop: bad proposals never reach the caller, and the model, run(), test_description_is_fenced_as_data(), test_gives_up_after_the_repair_budget_and_returns_errors_not_a_graph(), test_invalid_proposal_is_repaired_and_the_model_sees_the_error_codes(), test_output_that_is_not_a_graph_is_reported_as_a_schema_error(), test_result_event_is_canvas_shaped_json() (+2 more)

### Community 53 - "Community 53"
Cohesion: 0.2
Nodes (9): BpmnModdle, CmmnModdle, DmnModdle, FromXmlResult, GlobalModdleElement, GlobalModdleFromXmlResult, GlobalModdleToXmlResult, ModdleElement (+1 more)

### Community 54 - "Community 54"
Cohesion: 0.2
Nodes (9): EventKind, BoundaryEventNode, EndEventNode, EventNode, EventNodeProps, GLYPH, IntermediateEventNode, StartEventNode (+1 more)

### Community 55 - "Community 55"
Cohesion: 0.24
Nodes (7): createEmptyDecision(), DmnModel, nextId(), parseDmnXml(), serializeDmnXml(), roundTrip(), tier

### Community 56 - "Community 56"
Cohesion: 0.4
Nodes (9): after_event(), after_key_check(), after_provider_usage(), evaluate_budgets(), month_bounds(), _raise(), Budgets and alerts (SpendTracker.html Section 3d).  Alerts are raised where the, Raise a budget alert for every threshold crossed this month. (+1 more)

### Community 57 - "Community 57"
Cohesion: 0.2
Nodes (3): HTTP service. Users reach it through the edge gateway at /api/spend/**; services, Connection pool and a minimal forward-only migration runner.  Migrations are the, CWP API spend tracker (docs/archive/SpendTracker.html).

### Community 58 - "Community 58"
Cohesion: 0.2
Nodes (4): DeployAuthorityDeniedException, ManifestSerializationException, UnsupportedSpecTypeException, RuntimeException

### Community 59 - "Community 59"
Cohesion: 0.22
Nodes (3): Variables, DecisionController, ExpressionController

### Community 60 - "Community 60"
Cohesion: 0.31
Nodes (7): _provider_from_env(), RuntimeError, Provider selection from the environment., test_gemini_is_the_default(), test_missing_key_means_no_provider(), test_openai_compatible_providers_use_their_own_key(), test_unknown_provider_stops_startup()

### Community 62 - "Community 62"
Cohesion: 0.22
Nodes (8): Alerts, code:block1 (uv sync), Configuration, Container, Develop, Endpoints, Rules, Spend Tracker

### Community 63 - "Community 63"
Cohesion: 0.22
Nodes (8): Agentic Designer, code:block1 (uv sync), code:block2 (uv run python scripts/eval.py run --provider nvidia --model ), Container, Develop, Evaluate, Grounding (switched off), Status

### Community 64 - "Community 64"
Cohesion: 0.22
Nodes (8): API (`/runtime/**`, public `/api/flowable/**`), Auth and access, code:block1 (./run-local.sh                 # repo root: the whole stack ), Configuration, Container, Data, flowable-wrapper, Run and test

### Community 71 - "Community 71"
Cohesion: 0.29
Nodes (6): ExclusiveGatewayNode, GatewayNode, GatewayNodeProps, InclusiveGatewayNode, ParallelGatewayNode, VARIANT_STYLE

### Community 73 - "Community 73"
Cohesion: 0.33
Nodes (3): HttpSink, Posts each event to the spend-tracker service (SpendTracker.html S1)     on the, Wait for in-flight posts (tests, shutdown).

### Community 74 - "Community 74"
Cohesion: 0.29
Nodes (3): Conversion between WorkflowGraph and the Designer SPA's canvas format.  The canv, One Spec per notation the agent supports (BPMN, CMMN, DMN): its model, validator, Spec

### Community 83 - "Community 83"
Cohesion: 0.33
Nodes (5): code:block1 (npm ci), Configuration, Container, Develop, web-app

### Community 84 - "Community 84"
Cohesion: 0.33
Nodes (5): code:block1 (mvn test                 # signing keys, table ownership), Configuration, Container, identity-service, Run and test

### Community 85 - "Community 85"
Cohesion: 0.33
Nodes (5): code:block1 (mvn test                                        # identity c), Configuration, Container, design-service, Run and test

### Community 86 - "Community 86"
Cohesion: 0.5
Nodes (4): CATEGORIES_BY_SPEC, Palette(), PaletteProps, getPaletteItems()

### Community 87 - "Community 87"
Cohesion: 0.6
Nodes (4): fingerprint(), key_in(), main(), Diagnose Gemini API problems without printing the key.      uv run python script

### Community 91 - "Community 91"
Cohesion: 0.4
Nodes (4): code:block1 (createdb cwp && database/apply.sh --seed-local -- -d cwp), Common Workflow Platform (CWP), Layout, Start here

### Community 97 - "Community 97"
Cohesion: 0.5
Nodes (3): Configuration, Container, gateway

## Knowledge Gaps
- **264 isolated node(s):** `GlobalModdleElement`, `GlobalModdleFromXmlResult`, `GlobalModdleToXmlResult`, `ModdleElement`, `FromXmlResult` (+259 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **42 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `collect()` connect `Community 2` to `Community 0`, `Community 52`, `Community 14`, `Community 39`?**
  _High betweenness centrality (0.284) - this node is a cross-community bridge._
- **Why does `edit_workflow()` connect `Community 2` to `Community 8`, `Community 37`, `Community 22`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Are the 22 inferred relationships involving `WorkflowGraph` (e.g. with `_KeywordEmbedder` and `Issue`) actually correct?**
  _`WorkflowGraph` has 22 INFERRED edges - model-reasoned connections that need verification._
- **Are the 20 inferred relationships involving `Turn` (e.g. with `ScriptedProvider` and `RecordingSink`) actually correct?**
  _`Turn` has 20 INFERRED edges - model-reasoned connections that need verification._
- **Are the 24 inferred relationships involving `LLMProvider` (e.g. with `GenerateEvent` and `PatchProposal`) actually correct?**
  _`LLMProvider` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 20 inferred relationships involving `ProviderError` (e.g. with `EmptyThen` and `_KeywordEmbedder`) actually correct?**
  _`ProviderError` has 20 INFERRED edges - model-reasoned connections that need verification._
- **What connects `GlobalModdleElement`, `GlobalModdleFromXmlResult`, `GlobalModdleToXmlResult` to the rest of the system?**
  _264 weakly-connected nodes found - possible documentation gaps or missing edges._