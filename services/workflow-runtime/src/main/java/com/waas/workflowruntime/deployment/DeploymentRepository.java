package com.waas.workflowruntime.deployment;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Every finder here takes {@code tenantId} explicitly and deliberately --
 * there is no RLS backstop in this schema (WorkflowWrapper.html Section 7),
 * so tenant scoping has to be baked into the query itself rather than
 * relied on as an afterthought in the service layer.
 */
public interface DeploymentRepository extends JpaRepository<Deployment, UUID> {

    List<Deployment> findByTenantIdOrderByCreatedAtDesc(UUID tenantId);

    Optional<Deployment> findByIdAndTenantId(UUID id, UUID tenantId);
}
