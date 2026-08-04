package com.waas.runtimegateway.runtimeview;

import java.util.List;

import org.flowable.cmmn.api.CmmnRuntimeService;
import org.flowable.cmmn.api.runtime.CaseInstance;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.waas.runtimegateway.common.TenantContext;

/**
 * WorkflowWrapper.html Section 8, row 3 ({@code GET
 * /runtime/case-instances}) -- backs Workbench.html Section 7.1's CMMN
 * plan-item view. As of Section 9 Phase 7, this queries the real, embedded
 * {@link CmmnRuntimeService} instead of returning a stub -- Flowable
 * 8.0.0's Spring Boot 4 support (Section 4) removed the reason this used
 * to be a placeholder.
 */
@RestController
@RequestMapping("/runtime/case-instances")
public class CaseInstanceController {

    private final CmmnRuntimeService cmmnRuntimeService;

    public CaseInstanceController(CmmnRuntimeService cmmnRuntimeService) {
        this.cmmnRuntimeService = cmmnRuntimeService;
    }

    @GetMapping
    public List<CaseInstanceResponse> list() {
        String tenantId = TenantContext.currentTenantId().toString();
        List<CaseInstance> instances = cmmnRuntimeService.createCaseInstanceQuery()
                .caseInstanceTenantId(tenantId)
                .list();
        return instances.stream().map(CaseInstanceController::toResponse).toList();
    }

    private static CaseInstanceResponse toResponse(CaseInstance instance) {
        return new CaseInstanceResponse(
                instance.getId(),
                instance.getCaseDefinitionId(),
                instance.getBusinessKey(),
                instance.getName(),
                instance.getState(),
                instance.getTenantId(),
                instance.getStartTime() != null ? instance.getStartTime().toInstant() : null);
    }
}
