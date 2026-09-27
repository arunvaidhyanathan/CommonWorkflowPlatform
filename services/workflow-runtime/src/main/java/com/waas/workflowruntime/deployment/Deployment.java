package com.waas.workflowruntime.deployment;

import java.time.OffsetDateTime;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * The tenant-scoped audit/traceability record for a deployment
 * (WorkflowWrapper.html Section 8, row 1) -- now backed by one or more
 * REAL Flowable engine deployments (Section 9 Phase 7), whose ids are
 * recorded in {@link #engineDeploymentIdsJson}. This row exists so the
 * Governance Phase 4 SoD check (Governance.html Section 11.3) and
 * Designer.html Section 23.3's one-click Publish have a tenant-scoped
 * record to point at, and so this service never has to trust a caller's
 * claim about what got deployed -- it's the same row that drove the real
 * engine deployment.
 *
 * <p>Deliberately NOT related by a JPA {@code @ManyToOne}/foreign key to
 * any tenant entity -- this service does not own or model {@code
 * public.tenants} (that stays entirely Supabase/RLS-owned). {@code
 * tenantId} is a bare column, and every query against this table MUST be
 * scoped through {@link com.waas.workflowruntime.common.TenantContext},
 * never trusted from a request body/path alone.
 */
@Entity
@Table(name = "deployments", schema = "runtime")
public class Deployment {

    @Id
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "spec_type")
    private String specType;

    @Column(name = "description")
    private String description;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "created_by", updatable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    /**
     * JSON-encoded array of {@link ManifestArtifact}, stored as plain
     * {@code text} (not {@code jsonb}) -- see the changeset 005 comment in
     * {@code 002-add-deployment-manifest.sql} for why. Kept as an opaque
     * String here; (de)serialization lives in {@link DeploymentService},
     * not on this entity, so this class has no Jackson dependency.
     */
    @Column(name = "manifest_json", nullable = false)
    private String manifestJson;

    /**
     * JSON-encoded array of {@link EngineDeploymentRef} -- the real
     * Flowable deployment id(s) produced from {@link #manifestJson}
     * (WorkflowWrapper.html Section 9 Phase 7). Same "plain text, not
     * jsonb" reasoning as {@link #manifestJson}.
     */
    @Column(name = "engine_deployment_ids_json", nullable = false)
    private String engineDeploymentIdsJson;

    protected Deployment() {
        // JPA
    }

    public Deployment(UUID id, UUID tenantId, String name, String specType, String description,
            String status, UUID createdBy, OffsetDateTime createdAt, String manifestJson,
            String engineDeploymentIdsJson) {
        this.id = id;
        this.tenantId = tenantId;
        this.name = name;
        this.specType = specType;
        this.description = description;
        this.status = status;
        this.createdBy = createdBy;
        this.createdAt = createdAt;
        this.manifestJson = manifestJson;
        this.engineDeploymentIdsJson = engineDeploymentIdsJson;
    }

    public UUID getId() {
        return id;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public String getName() {
        return name;
    }

    public String getSpecType() {
        return specType;
    }

    public String getDescription() {
        return description;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public UUID getCreatedBy() {
        return createdBy;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }

    public String getManifestJson() {
        return manifestJson;
    }

    public String getEngineDeploymentIdsJson() {
        return engineDeploymentIdsJson;
    }
}
