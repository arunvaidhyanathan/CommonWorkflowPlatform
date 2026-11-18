package com.waas.workflowruntime.deployment;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.UUID;

import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import org.flowable.cmmn.api.CmmnRepositoryService;
import org.flowable.dmn.api.DmnRepositoryService;
import org.flowable.engine.RepositoryService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.waas.workflowruntime.common.DeployAuthorityDeniedException;
import com.waas.workflowruntime.common.ManifestSerializationException;
import com.waas.workflowruntime.common.TenantContext;
import com.waas.workflowruntime.common.UnsupportedSpecTypeException;

/**
 * Governance Phase 4 (Governance.html Section 11.3): a deliberately simple,
 * explicit Separation-of-Duties gate on who may create a deployment record.
 * Today this is a flat allow-list of one role ({@code tenant_admin}) --
 * NOT yet the fuller "the author of this definition cannot also deploy it"
 * check that section calls out as an open design question, because that
 * needs definition-authorship history this service doesn't model yet.
 * Written so that check lives in exactly one place ({@link
 * #assertDeployAuthority()}) and is easy to find and replace later.
 *
 * <p>WorkflowWrapper.html Section 9 Phase 7: {@link #create} now deploys
 * each manifest artifact to a REAL, embedded Flowable engine --
 * {@link RepositoryService} for BPMN, {@link CmmnRepositoryService} for
 * CMMN, {@link DmnRepositoryService} for DMN -- tagged with the caller's
 * tenant via Flowable's own native multi-tenancy. The {@code
 * runtime.deployments} row this service still writes is the tenant-scoped
 * audit trail pointing at those real engine deployment ids (Section 5),
 * not a synthetic placeholder the way it was before this correction.
 */
@Service
public class DeploymentService {

    private static final Set<String> DEPLOY_AUTHORITY_ROLES = Set.of("tenant_admin");
    private static final TypeReference<List<ManifestArtifact>> MANIFEST_LIST_TYPE =
            new TypeReference<>() {};
    private static final TypeReference<List<EngineDeploymentRef>> ENGINE_REF_LIST_TYPE =
            new TypeReference<>() {};

    private final DeploymentRepository deploymentRepository;
    private final ObjectMapper objectMapper;
    private final RepositoryService repositoryService;
    private final CmmnRepositoryService cmmnRepositoryService;
    private final DmnRepositoryService dmnRepositoryService;

    private final boolean scriptsEnabled;
    private final org.flowable.app.api.AppRepositoryService appRepositoryService;
    private final com.waas.workflowruntime.design.DesignDb designDb;

    public DeploymentService(
            DeploymentRepository deploymentRepository,
            ObjectMapper objectMapper,
            RepositoryService repositoryService,
            CmmnRepositoryService cmmnRepositoryService,
            DmnRepositoryService dmnRepositoryService,
            org.flowable.app.api.AppRepositoryService appRepositoryService,
            @org.springframework.beans.factory.annotation.Value("${cwp.scripts.enabled:false}") boolean scriptsEnabled,
            com.waas.workflowruntime.design.DesignDb designDb) {
        this.designDb = designDb;
        this.scriptsEnabled = scriptsEnabled;
        this.deploymentRepository = deploymentRepository;
        this.objectMapper = objectMapper;
        this.repositoryService = repositoryService;
        this.cmmnRepositoryService = cmmnRepositoryService;
        this.dmnRepositoryService = dmnRepositoryService;
        this.appRepositoryService = appRepositoryService;
    }

    @Transactional
    public DeploymentResponse create(CreateDeploymentRequest request) {
        assertDeployAuthority();

        UUID tenantId = TenantContext.currentTenantId();
        UUID createdBy = TenantContext.currentUserId();

        List<EngineDeploymentRef> engineDeployments = deployToEngines(request, tenantId);

        Deployment deployment = new Deployment(
                UUID.randomUUID(),
                tenantId,
                request.name(),
                request.specType(),
                request.description(),
                "deployed",
                createdBy,
                OffsetDateTime.now(),
                writeJson(request.manifest()),
                writeJson(engineDeployments));

        Deployment saved = deploymentRepository.save(deployment);
        return DeploymentResponse.from(saved, request.manifest(), engineDeployments);
    }

    /**
     * Deploys every manifest artifact to whichever real Flowable engine
     * matches its {@code specType}. Each engine has its own {@code
     * RepositoryService}-shaped deployment builder, and a resource's file
     * extension (not just its content) is how each engine's deployer
     * recognizes it -- so the resource name is built from {@code
     * definitionKey} plus the engine-appropriate suffix, not just reused
     * verbatim from the request.
     */
    private List<EngineDeploymentRef> deployToEngines(CreateDeploymentRequest request, UUID tenantId) {
        List<EngineDeploymentRef> refs = new ArrayList<>();
        String tenantIdString = tenantId.toString();

        // Refuse the whole manifest before deploying anything if any artifact has a script (ScriptPolicy).
        request.manifest().forEach(a -> ScriptPolicy.check(a.definitionKey(), a.xml(), scriptsEnabled));

        // #13: several artifacts deploy together as one Flowable app, so the related
        // definitions (e.g. a process, the case it starts and the decisions the case
        // uses) are versioned and released as a unit. One artifact deploys as before.
        if (request.manifest().size() > 1) {
            return deployAsApp(request, tenantIdString);
        }

        for (ManifestArtifact artifact : request.manifest()) {
            String specType = artifact.specType().toUpperCase(Locale.ROOT);
            String deploymentName = request.name() + " -- " + artifact.name();

            String engineDeploymentId = switch (specType) {
                case "BPMN" -> repositoryService.createDeployment()
                        .name(deploymentName)
                        .addString(artifact.definitionKey() + ".bpmn20.xml", artifact.xml())
                        .tenantId(tenantIdString)
                        .deploy()
                        .getId();
                case "CMMN" -> cmmnRepositoryService.createDeployment()
                        .name(deploymentName)
                        .addString(artifact.definitionKey() + ".cmmn", artifact.xml())
                        .tenantId(tenantIdString)
                        .deploy()
                        .getId();
                case "DMN" -> dmnRepositoryService.createDeployment()
                        .name(deploymentName)
                        .addString(artifact.definitionKey() + ".dmn", artifact.xml())
                        .tenantId(tenantIdString)
                        .deploy()
                        .getId();
                default -> throw new UnsupportedSpecTypeException(
                        "Manifest artifact '" + artifact.definitionKey() + "' has unsupported specType '"
                                + artifact.specType() + "' (expected BPMN, CMMN, or DMN).");
            };

            refs.add(new EngineDeploymentRef(specType, engineDeploymentId));
        }

        return refs;
    }

    private static String resourceName(ManifestArtifact artifact) {
        return switch (artifact.specType().toUpperCase(Locale.ROOT)) {
            case "BPMN" -> artifact.definitionKey() + ".bpmn20.xml";
            case "CMMN" -> artifact.definitionKey() + ".cmmn";
            case "DMN" -> artifact.definitionKey() + ".dmn";
            default -> throw new UnsupportedSpecTypeException(
                    "Manifest artifact '" + artifact.definitionKey() + "' has unsupported specType '"
                            + artifact.specType() + "' (expected BPMN, CMMN, or DMN).");
        };
    }

    /** App key: the request's appKey, else derived from its name (letters, digits, _ and -). */
    static String appKey(CreateDeploymentRequest request) {
        String raw = request.appKey() != null && !request.appKey().isBlank() ? request.appKey() : request.name();
        String key = raw.trim().replaceAll("[^A-Za-z0-9_-]+", "_").replaceAll("^_+|_+$", "");
        if (key.isEmpty() || !Character.isLetter(key.charAt(0)) && key.charAt(0) != '_') {
            key = "app_" + key;
        }
        return key;
    }

    private List<EngineDeploymentRef> deployAsApp(CreateDeploymentRequest request, String tenantId) {
        String key = appKey(request);
        Map<String, String> descriptor = new LinkedHashMap<>();
        descriptor.put("key", key);
        descriptor.put("name", request.name());
        if (request.description() != null) {
            descriptor.put("description", request.description());
        }
        var builder = appRepositoryService.createDeployment()
                .name(request.name())
                .key(key)
                .tenantId(tenantId)
                .addString(key + ".app", writeJson(descriptor));
        for (ManifestArtifact artifact : request.manifest()) {
            builder.addString(resourceName(artifact), artifact.xml());
        }
        String appDeploymentId = builder.deploy().getId();

        // The app engine hands each model to its engine as a child deployment.
        List<EngineDeploymentRef> refs = new ArrayList<>();
        refs.add(new EngineDeploymentRef("APP", appDeploymentId));
        repositoryService.createDeploymentQuery().parentDeploymentId(appDeploymentId).list()
                .forEach(d -> refs.add(new EngineDeploymentRef("BPMN", d.getId())));
        cmmnRepositoryService.createDeploymentQuery().parentDeploymentId(appDeploymentId).list()
                .forEach(d -> refs.add(new EngineDeploymentRef("CMMN", d.getId())));
        dmnRepositoryService.createDeploymentQuery().parentDeploymentId(appDeploymentId).list()
                .forEach(d -> refs.add(new EngineDeploymentRef("DMN", d.getId())));
        return refs;
    }

    @Transactional(readOnly = true)
    public List<DeploymentResponse> list() {
        UUID tenantId = TenantContext.currentTenantId();
        return deploymentRepository.findByTenantIdOrderByCreatedAtDesc(tenantId).stream()
                .map(deployment -> DeploymentResponse.from(
                        deployment,
                        readJson(deployment.getManifestJson(), MANIFEST_LIST_TYPE, deployment.getId()),
                        readJson(deployment.getEngineDeploymentIdsJson(), ENGINE_REF_LIST_TYPE, deployment.getId())))
                .toList();
    }

    @Transactional(readOnly = true)
    public DeploymentResponse get(UUID id) {
        UUID tenantId = TenantContext.currentTenantId();
        Deployment deployment = deploymentRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new NoSuchElementException("No deployment " + id + " in this tenant"));
        return DeploymentResponse.from(
                deployment,
                readJson(deployment.getManifestJson(), MANIFEST_LIST_TYPE, deployment.getId()),
                readJson(deployment.getEngineDeploymentIdsJson(), ENGINE_REF_LIST_TYPE, deployment.getId()));
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JacksonException e) {
            throw new ManifestSerializationException("Could not serialize deployment data", e);
        }
    }

    private <T> T readJson(String json, TypeReference<T> type, UUID deploymentId) {
        try {
            return objectMapper.readValue(json, type);
        } catch (JacksonException e) {
            throw new ManifestSerializationException(
                    "Could not deserialize stored JSON for deployment " + deploymentId, e);
        }
    }

    /**
     * Deploying runs the model's expressions in the shared engines, so the role
     * and active status are re-read from the database (DesignDb.writer), not
     * trusted from the login token: a demoted or deactivated admin loses deploy
     * authority at once, not when their token expires.
     */
    private void assertDeployAuthority() {
        String role = TenantContext.currentRole();
        if (role == null || !DEPLOY_AUTHORITY_ROLES.contains(role)) {
            throw new DeployAuthorityDeniedException(
                    "Role '" + role + "' does not have deploy authority (Governance.html Section 11.3, Phase 4 provisional rule: tenant_admin only).");
        }
        designDb.writer(DEPLOY_AUTHORITY_ROLES.toArray(String[]::new));
    }
}
