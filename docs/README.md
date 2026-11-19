# CWP documentation

| Document | Read it for |
|---|---|
| [architecture.md](architecture.md) | The seven services, request flow, auth, internal calls, data ownership, production characteristics |
| [deployment-openshift.md](deployment-openshift.md) | Step by step: OpenShift project, PostgreSQL, secrets, images, deploy, network policies, verify, scaling |
| [database.md](database.md) | Schemas and roles, the scripts in `database/`, triggers, schema changes, connections |
| [operations.md](operations.md) | Probes, secrets and rotation, logs and request ids, troubleshooting |
| [local-development.md](local-development.md) | Running everything locally (native or compose) and the test suites |
| [code-maps/](code-maps/index.html) | Generated maps: architecture diagram (Archify), knowledge graph (Graphify), symbol index (CodeGraph) |
| [archive/](archive/README.md) | The original design documents, kept for history |

Each service's own README (in `services/<service>/`) documents its API,
configuration, container and scaling notes.
