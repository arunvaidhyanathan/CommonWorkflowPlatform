package com.waas.flowablewrapper.work;

import java.util.HashMap;
import java.util.Map;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import org.flowable.common.engine.api.delegate.Expression;
import org.flowable.common.engine.impl.el.ExpressionManager;
import org.flowable.common.engine.impl.variable.MapDelegateVariableContainer;
import org.flowable.common.engine.api.variable.VariableContainer;
import org.flowable.engine.ManagementService;
import org.flowable.engine.ProcessEngineConfiguration;
import org.flowable.engine.impl.cfg.ProcessEngineConfigurationImpl;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Expression tester (#12): evaluates a ${...} expression against sample
 * variables with the process engine's own expression manager -- the same
 * sandbox as deployed models (no beans, no reflection), Flowable 8 features
 * included: lambdas and stream() on collections, Java records, vars: functions.
 * Lets designers check a condition before deploying it. Designers and tenant
 * admins only; nothing is stored.
 */
@RestController
@RequestMapping("/runtime/expressions")
public class ExpressionController {

    public record EvaluateRequest(@NotBlank @Size(max = 4000) String expression, Map<String, Object> variables) {
    }

    public record EvaluateResult(boolean ok, Object value, String valueType, String error) {
    }

    private final WorkAccess access;
    private final ManagementService management;
    private final ExpressionManager expressions;

    ExpressionController(WorkAccess access, ManagementService management, ProcessEngineConfiguration configuration) {
        this.access = access;
        this.management = management;
        this.expressions = ((ProcessEngineConfigurationImpl) configuration).getExpressionManager();
    }

    @PostMapping("/evaluate")
    public EvaluateResult evaluate(@Valid @RequestBody EvaluateRequest request) {
        if (!java.util.List.of("designer", "tenant_admin").contains(com.waas.flowablewrapper.common.TenantContext.currentRole())) {
            throw WorkAccess.forbidden("Only designers and tenant admins can test expressions.");
        }
        access.tenantId();
        Map<String, Object> variables = request.variables() == null ? new HashMap<>() : new HashMap<>(request.variables());
        try {
            Object value = management.executeCommand(commandContext -> {
                Expression expression = expressions.createExpression(request.expression());
                VariableContainer container = new MapDelegateVariableContainer(variables, VariableContainer.empty());
                return expression.getValue(container);
            });
            return new EvaluateResult(true, value, value == null ? null : value.getClass().getSimpleName(), null);
        } catch (RuntimeException e) {
            Throwable root = e;
            while (root.getCause() != null && root.getCause() != root) {
                root = root.getCause();
            }
            return new EvaluateResult(false, null, null, root.getMessage());
        }
    }
}
