package com.waas.workflowruntime.work;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.flowable.dmn.api.DecisionExecutionAuditContainer;
import org.flowable.dmn.api.DecisionServiceExecutionAuditContainer;
import org.flowable.dmn.api.DmnDecision;
import org.flowable.dmn.api.DmnDecisionService;
import org.flowable.dmn.api.DmnRepositoryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Deployed DMN decisions and decision services, and a tester that evaluates
 * one with given inputs and explains the outcome (which rules matched in
 * each decision). Read-only for the model; any tenant member may test.
 *
 * <p>Only decision services and standalone decisions have their own key:
 * decisions encapsulated in a service are evaluated through the service.
 */
@RestController
@RequestMapping("/runtime/decisions")
public class DecisionController {

    public record DecisionSummary(String id, String key, String name, int version, String type) {
    }

    /** One evaluated decision: its result rows and the 1-based numbers of the rules that matched. */
    public record DecisionTrace(String key, String name, String hitPolicy, List<Map<String, Object>> result,
            List<Integer> matchedRules, boolean failed, String message) {
    }

    public record Evaluation(String key, String type, Object result, List<DecisionTrace> decisions) {
    }

    private final WorkAccess access;
    private final DmnRepositoryService repository;
    private final DmnDecisionService decisions;

    DecisionController(WorkAccess access, DmnRepositoryService repository, DmnDecisionService decisions) {
        this.access = access;
        this.repository = repository;
        this.decisions = decisions;
    }

    @GetMapping
    public List<DecisionSummary> list() {
        return repository.createDecisionQuery().decisionTenantId(access.tenantId()).latestVersion().list().stream()
                .map(d -> new DecisionSummary(d.getId(), d.getKey(), d.getName(), d.getVersion(), d.getDecisionType()))
                .toList();
    }

    @PostMapping("/{key}/evaluate")
    public Evaluation evaluate(@PathVariable String key, @RequestBody(required = false) Map<String, Object> variables) {
        String tenant = access.tenantId();
        DmnDecision decision = repository.createDecisionQuery().decisionKey(key).decisionTenantId(tenant)
                .latestVersion().singleResult();
        if (decision == null) {
            throw WorkAccess.notFound("Decision '" + key + "'");
        }
        Map<String, Object> inputs = variables == null ? Map.of() : variables;
        var builder = decisions.createExecuteDecisionBuilder().decisionKey(key).tenantId(tenant).variables(inputs);

        if ("decision_service".equals(decision.getDecisionType())) {
            DecisionServiceExecutionAuditContainer audit = builder.executeDecisionServiceWithAuditTrail();
            List<DecisionTrace> traces = new ArrayList<>();
            audit.getChildDecisionExecutions().values().forEach(child -> traces.add(trace(child)));
            return new Evaluation(key, decision.getDecisionType(), audit.getDecisionServiceResult(), traces);
        }
        DecisionExecutionAuditContainer audit = builder.executeWithAuditTrail();
        return new Evaluation(key, decision.getDecisionType(), audit.getDecisionResult(), List.of(trace(audit)));
    }

    private static DecisionTrace trace(DecisionExecutionAuditContainer audit) {
        List<Integer> matched = new TreeMap<>(audit.getRuleExecutions()).entrySet().stream()
                .filter(e -> e.getValue().isValid()).map(Map.Entry::getKey).toList();
        return new DecisionTrace(audit.getDecisionKey(), audit.getDecisionName(),
                audit.getHitPolicy(),
                audit.getDecisionResult(), matched, audit.isFailed(), audit.getExceptionMessage());
    }
}
