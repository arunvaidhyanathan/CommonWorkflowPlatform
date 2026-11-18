--liquibase formatted sql

-- WorkflowWrapper.html Section 9 Phase 2 (Designer.html Section 23.1's
-- .bar-shaped packaging): a deployment now carries the actual packaged
-- artifact(s), not just deploy metadata. Stored as plain `text` holding a
-- JSON-encoded array (Deployment.java's manifestJson field), not `jsonb` --
-- deliberately avoids depending on Hibernate's JSON type-mapping behavior
-- (org.hibernate.annotations.JdbcTypeCode) working correctly on a stack
-- that has never been compiled (WorkflowWrapper.html Section 0's update
-- callout). Application code (DeploymentService) serializes/deserializes
-- this via Jackson; nothing here relies on Postgres understanding the
-- column as structured JSON. Revisit as a real `jsonb` column, with proper
-- indexing/querying, once this service has actually been built and run.

--changeset arun:005-add-deployments-manifest-json
alter table runtime.deployments
    add column if not exists manifest_json text not null default '[]';

--changeset arun:006-deployments-manifest-json-comment
comment on column runtime.deployments.manifest_json is
    'JSON-encoded array of packaged artifacts ({definitionKey, name, specType, xml}) for this deployment (WorkflowWrapper.html Section 9 Phase 2). Plain text, not jsonb -- see changeset 005.';
