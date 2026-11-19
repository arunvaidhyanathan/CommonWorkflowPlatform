# CodeGraph snapshot: CommonWorkflowPlatform

Generated with [CodeGraph](https://github.com/colbymchenry/codegraph) 1.6.3 from the local index (`.codegraph/`, not committed). Regenerate: `codegraph sync && python3 -I Documents/codegraph/export.py .` (see [CodeMaps.html](../CodeMaps.html)).

## Index

- Files: 200 (java 68, javascript 1, python 55, tsx 38, typescript 30, xml 3, yaml 5)
- Symbols: 4827, edges: 9817
- By kind: import 1332, function 792, method 741, property 467, field 413, class 225, file 195, variable 193, constant 182, interface 79, route 78, namespace 68, type_alias 33, component 29
- Parse errors: 0

## Routes detected

HTTP routes CodeGraph found: Spring `@*Mapping` endpoints, FastAPI routes and the SPA's React Router routes. Paths are as each service serves them (the gateway adds `/api/identity`, `/api/design`, `/api/flowable`, ...).

- `Designer/src/App.tsx`: `/` (L37), `/designer` (L38), `/onboarding` (L39), `/workbench` (L40), `/tasks` (L41), `/instances` (L42), `/decisions` (L43), `/workflow-wrapper` (L44), `/agentic-designer` (L46), `/admin` (L47), `/approvals` (L55), `/jobs` (L63), `/spend` (L71), `/*` (L82)
- `services/design-service/src/main/java/com/waas/design/ApprovalController.java`: `POST /design/approvals` (L48), `GET /design/approvals/pending` (L66), `POST /design/approvals/{id}/decision` (L86)
- `services/design-service/src/main/java/com/waas/design/AuditController.java`: `GET /design/audit` (L34)
- `services/design-service/src/main/java/com/waas/design/InternalAuditController.java`: `POST /internal/design/audit` (L45)
- `services/design-service/src/main/java/com/waas/design/WorkflowController.java`: `GET /design/workflows` (L71), `GET /design/workflows/key-taken` (L78), `GET /design/workflows/{id}` (L86), `POST /design/workflows` (L94), `POST /design/workflows/{id}/versions` (L110), `GET /design/versions/{id}` (L139), `POST /design/workflows/{id}/archive` (L151), `DELETE /design/workflows/{id}` (L164)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/deployment/DeploymentController.java`: `POST /runtime/deployments` (L35), `GET /runtime/deployments` (L45), `GET /runtime/deployments/{id}` (L50)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/runtimeview/CaseInstanceController.java`: `GET /runtime/case-instances` (L31)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/runtimeview/FormDefinitionController.java`: `GET /runtime/form-definitions/{id}` (L33)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/runtimeview/TaskInstanceHistoryController.java`: `GET /runtime/history/task-instances` (L32)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/work/DecisionController.java`: `GET /runtime/decisions` (L53), `POST /runtime/decisions/{key}/evaluate` (L60)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/work/DynamicController.java`: `POST /runtime/instances/process/{id}/inject-task` (L64), `POST /runtime/instances/case/{id}/inject-plan-item` (L83)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/work/ExpressionController.java`: `POST /runtime/expressions/evaluate` (L50)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/work/HistoryController.java`: `GET /runtime/instances/{kind}/{id}/timeline` (L73), `PUT /runtime/instances/{kind}/{id}/business-status` (L113), `GET /runtime/instances/{kind}/{id}/business-status` (L129)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/work/InstanceController.java`: `GET /runtime/definitions` (L104), `POST /runtime/instances` (L130), `GET /runtime/instances` (L145), `GET /runtime/instances/{kind}/{id}` (L162), `PUT /runtime/instances/{kind}/{id}/variables` (L187), `DELETE /runtime/instances/{kind}/{id}` (L207)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/work/JobController.java`: `GET /runtime/jobs` (L51), `GET /runtime/jobs/{id}/stacktrace` (L75), `POST /runtime/jobs/{id}/retry` (L82), `DELETE /runtime/jobs/{id}` (L95), `POST /runtime/jobs/{id}/fire` (L108)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/work/MigrationController.java`: `GET /runtime/definitions/{kind}/{key}/versions` (L114), `POST /runtime/migrations/validate` (L134), `POST /runtime/migrations` (L148), `POST /runtime/migrations/batch` (L169), `GET /runtime/migrations/batches/{kind}/{id}` (L180)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/work/PlanItemController.java`: `POST /runtime/plan-items/{id}/{action}` (L51)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/work/ProcessEventController.java`: `POST /runtime/instances/process/{id}/adhoc/{activityId}` (L66), `POST /runtime/instances/process/{id}/signal/{name}` (L74), `POST /runtime/instances/process/{id}/message/{name}` (L82)
- `services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/work/TaskController.java`: `GET /runtime/tasks` (L51), `GET /runtime/tasks/{id}` (L70), `POST /runtime/tasks/{id}/claim` (L83), `POST /runtime/tasks/{id}/unclaim` (L95), `POST /runtime/tasks/{id}/complete` (L108)
- `services/identity-service/src/main/java/com/waas/identity/AuthController.java`: `POST /identity/auth/login` (L62)
- `services/identity-service/src/main/java/com/waas/identity/InternalController.java`: `GET /internal/identity/tenants/{tenantId}/members/{userId}` (L40)
- `services/identity-service/src/main/java/com/waas/identity/MemberController.java`: `GET /identity/members` (L74), `POST /identity/members` (L90), `PUT /identity/members/{id}/role` (L109), `PUT /identity/members/{id}/groups` (L128), `PUT /identity/members/{id}/status` (L146), `GET /identity/invites` (L167), `POST /identity/invites/{id}/revoke` (L180), `GET /identity/me` (L193), `POST /identity/me/dismiss-getting-started` (L203)
- `services/identity-service/src/main/java/com/waas/identity/config/JwksController.java`: `GET /.well-known/jwks.json` (L21)

## Cross-service seams (callers)

### `requireActive`

Role/status re-check against identity-service (design-service and flowable-wrapper)

```
Callers of "requireActive" — 3 distinct definitions (narrow with --file):

method com.waas.design::IdentityClient::requireActive (java) — services/design-service/src/main/java/com/waas/design/IdentityClient.java:65 (3):

method      demotedApproverLosesApprovalRightsOnceTheCacheExpires
  services/design-service/src/test/java/com/waas/design/IdentityClientTest.java:73, 77, 80

method      writer
  services/design-service/src/main/java/com/waas/design/DesignDb.java:50

method      deactivatedOrUnknownUsersCannotWrite
  services/design-service/src/test/java/com/waas/design/IdentityClientTest.java:88, 92


method com.waas.flowablewrapper.identity::HttpIdentityDirectory::requireActive (java) — services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/identity/HttpIdentityDirectory.java:63 (5):

method      nonMembersAreRefusedAndNotTaskCandidates
  services/flowable-wrapper/src/test/java/com/waas/flowablewrapper/identity/HttpIdentityDirectoryTest.java:93

method      requireActive
  services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/identity/IdentityDirectory.java:24

method      repeatedChecksWithinTheTtlCallIdentityServiceOnce
  services/flowable-wrapper/src/test/java/com/waas/flowablewrapper/identity/HttpIdentityDirectoryTest.java:84

method      roleFromIdentityServiceWinsOverTheTokenClaim
  services/flowable-wrapper/src/test/java/com/waas/flowablewrapper/identity/HttpIdentityDirectoryTest.java:77

method      deactivationTakesEffectOnceTheCacheExpires
  services/flowable-wrapper/src/test/java/com/waas/flowablewrapper/identity/HttpIdentityDirectoryTest.java:61, 65, 68


method com.waas.flowablewrapper.identity::IdentityDirectory::requireActive (java) — services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/identity/IdentityDirectory.java:24 (2):

method      assertDeployAuthority
  services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/deployment/DeploymentService.java:269

method      writer
  services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/work/WorkAccess.java:51
```

### `groupKeys` in `HttpIdentityDirectory.java`

Task candidate groups from identity-service (flowable-wrapper)

```
Callers of "groupKeys" (3):

method com.waas.flowablewrapper.identity::HttpIdentityDirectory::groupKeys (java) — services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/identity/HttpIdentityDirectory.java:78
method      nonMembersAreRefusedAndNotTaskCandidates
  services/flowable-wrapper/src/test/java/com/waas/flowablewrapper/identity/HttpIdentityDirectoryTest.java:95

method      groupKeys
  services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/identity/IdentityDirectory.java:27

method      repeatedChecksWithinTheTtlCallIdentityServiceOnce
  services/flowable-wrapper/src/test/java/com/waas/flowablewrapper/identity/HttpIdentityDirectoryTest.java:85
```

### `isActiveMember` in `HttpIdentityDirectory.java`

Assignee must be an active tenant member (flowable-wrapper)

```
Callers of "isActiveMember" (3):

method com.waas.flowablewrapper.identity::HttpIdentityDirectory::isActiveMember (java) — services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/identity/HttpIdentityDirectory.java:83
method      nonMembersAreRefusedAndNotTaskCandidates
  services/flowable-wrapper/src/test/java/com/waas/flowablewrapper/identity/HttpIdentityDirectoryTest.java:96, 97

method      isActiveMember
  services/flowable-wrapper/src/main/java/com/waas/flowablewrapper/identity/IdentityDirectory.java:30

method      repeatedChecksWithinTheTtlCallIdentityServiceOnce
  services/flowable-wrapper/src/test/java/com/waas/flowablewrapper/identity/HttpIdentityDirectoryTest.java:86
```

### `record` in `DesignAudit.java`

identity-service posting role/status changes to design-service's audit log

```
Callers of "record" (2):

method com.waas.identity::DesignAudit::record (java) — services/identity-service/src/main/java/com/waas/identity/DesignAudit.java:28
method      setStatus
  services/identity-service/src/main/java/com/waas/identity/MemberController.java:162

method      setRole
  services/identity-service/src/main/java/com/waas/identity/MemberController.java:124
```

### `writer` in `DesignDb.java`

Every design-time write goes through DesignDb.writer() (identity check + audit claims)

```
Callers of "writer" (6):

method com.waas.design::DesignDb::writer (java) — services/design-service/src/main/java/com/waas/design/DesignDb.java:49
method      delete
  services/design-service/src/main/java/com/waas/design/WorkflowController.java:168

method      archive
  services/design-service/src/main/java/com/waas/design/WorkflowController.java:155

method      create
  services/design-service/src/main/java/com/waas/design/WorkflowController.java:98

method      submit
  services/design-service/src/main/java/com/waas/design/ApprovalController.java:52

method      decide
  services/design-service/src/main/java/com/waas/design/ApprovalController.java:90

method      saveVersion
  services/design-service/src/main/java/com/waas/design/WorkflowController.java:114
```

### `writer` in `IdentityDb.java`

Every identity write goes through IdentityDb.writer()

```
Callers of "writer" (5):

method com.waas.identity::IdentityDb::writer (java) — services/identity-service/src/main/java/com/waas/identity/IdentityDb.java:34
method      setStatus
  services/identity-service/src/main/java/com/waas/identity/MemberController.java:150

method      createUser
  services/identity-service/src/main/java/com/waas/identity/MemberController.java:94

method      setRole
  services/identity-service/src/main/java/com/waas/identity/MemberController.java:113

method      revokeInvite
  services/identity-service/src/main/java/com/waas/identity/MemberController.java:184

method      setGroups
  services/identity-service/src/main/java/com/waas/identity/MemberController.java:132
```

### `apiFetch`

SPA calls to the backend (one client for every service)

```
Callers of "apiFetch" (40 of 74):

function apiFetch (typescript) — Designer/src/lib/apiClient.ts:72
function    evaluateExpression
  Designer/src/data/work.ts:243

function    startBatchMigration
  Designer/src/data/work.ts:182

function    getTimeline
  Designer/src/data/work.ts:231

function    listTenantMembers
  Designer/src/data/admin.ts:22

function    retryJob
  Designer/src/data/work.ts:238

function    startInstance
  Designer/src/data/work.ts:114

function    setBusinessStatus
  Designer/src/data/work.ts:234

function    completeTask
  Designer/src/data/work.ts:257

function    listDecisions
  Designer/src/data/work.ts:134

function    createDeployment
  Designer/src/data/deployments.ts:57

function    getOpenAlerts
  Designer/src/data/spend.ts:109

function    acknowledgeAlert
  Designer/src/data/spend.ts:113

function    listAuditLog
  Designer/src/data/auditLog.ts:19

function    getBatch
  Designer/src/data/work.ts:185

function    revokeInvite
  Designer/src/data/invites.ts:22

function    loadWorkflowVersion
  Designer/src/data/workflows.ts:110

function    listVersions
  Designer/src/data/work.ts:173

function    getSpendSummary
  Designer/src/data/spend.ts:75

function    saveDraftVersion
  Designer/src/data/workflows.ts:98

function    getBudgets
  Designer/src/data/spend.ts:94

function    runKeyChecks
  Designer/src/data/spend.ts:89

function    unclaimTask
  Designer/src/data/work.ts:254

function    terminateInstance
  Designer/src/data/work.ts:129

function    listCaseInstances
  Designer/src/data/caseInstances.ts:18

function    listDefinitions
  Designer/src/data/work.ts:107

function    validateMigration
  Designer/src/data/work.ts:176

function    getTask
  Designer/src/data/work.ts:250

function    getKeyStatus
  Designer/src/data/spend.ts:81

function    setBudget
  Designer/src/data/spend.ts:98

function    jobStacktrace
  Designer/src/data/work.ts:237

function    getMyProfile
  Designer/src/data/profile.ts:13

function    decideApproval
  Designer/src/data/approvals.ts:46

function    createWorkflowFromImport
  Designer/src/data/workflows.ts:78

function    claimTask
  Designer/src/data/work.ts:252

function    planItemAction
  Designer/src/data/work.ts:132

function    setMemberStatus
  Designer/src/data/admin.ts:50

function    listDeployments
  Designer/src/data/deployments.ts:70

function    getDeployment
  Designer/src/data/deployments.ts:74

function    listPendingApprovals
  Designer/src/data/approvals.ts:37

function    dismissGettingStarted
  Designer/src/data/profile.ts:17

Showing 40 of 74; pass --limit to widen.
```
