--liquibase formatted sql

-- WorkflowWrapper.html Section 9 Phase 7 (real Flowable engine embedding,
-- Section 5): a deployment now results in one or more REAL Flowable
-- engine deployments (one per manifest artifact, since BPMN/CMMN/DMN each
-- have their own RepositoryService). This column records which real
-- engine deployment ID(s) resulted, so `runtime.deployments` stays a
-- true traceability record rather than just bookkeeping -- consistent
-- with the "why a new schema, not a new database" reasoning (Section 3):
-- this table is the audit trail that ties Supabase-side approval history
-- to the actual Flowable deployment(s) it produced.
--
-- Same "plain text, not jsonb" reasoning as manifest_json (see changeset
-- 005 in 002-add-deployment-manifest.sql): avoids depending on Hibernate's
-- JSON type-mapping behavior on an uncompiled stack. Application code
-- (DeploymentService) serializes/deserializes this via Jackson.

--changeset arun:007-add-deployments-engine-deployment-ids
alter table runtime.deployments
    add column if not exists engine_deployment_ids_json text not null default '[]';

--changeset arun:008-deployments-engine-deployment-ids-comment
comment on column runtime.deployments.engine_deployment_ids_json is
    'JSON-encoded array of {specType, engineDeploymentId} for the real Flowable deployment(s) this record produced (WorkflowWrapper.html Section 9 Phase 7). Plain text, not jsonb -- see changeset 005 in 002-add-deployment-manifest.sql for why.';
