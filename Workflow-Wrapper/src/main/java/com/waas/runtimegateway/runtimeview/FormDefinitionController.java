package com.waas.runtimegateway.runtimeview;

import java.util.NoSuchElementException;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.waas.runtimegateway.common.TenantContext;

/**
 * Stub for WorkflowWrapper.html Section 8, row 3 ({@code GET
 * /runtime/form-definitions/{id}}) -- backs Workbench.html Section 7.2's
 * dynamic Flowable form renderer. Unlike {@link CaseInstanceController}
 * and {@link TaskInstanceHistoryController}, embedding Flowable 8.0.0
 * (Section 9 Phase 7) did NOT unblock this one: the standalone Flowable
 * Form Engine (a separate, independently versioned {@code
 * FormRepositoryService}) this endpoint was modeled on was deprecated as
 * of Flowable 7.0.1 and isn't part of {@code flowable-spring-boot-starter}
 * 8.0.0. Flowable 8's actual form mechanism is the Process/CMMN engine's
 * own {@code FormService}, tied to a specific process/case definition's
 * embedded form key rather than an independently browsable repository --
 * a real redesign, not a "swap the backing" change (Designer.html Section
 * 23.2, WorkflowWrapper.html Section 10). Still 404s via the shared
 * {@link com.waas.runtimegateway.common.GlobalExceptionHandler} until that
 * redesign happens.
 */
@RestController
@RequestMapping("/runtime/form-definitions")
public class FormDefinitionController {

    @GetMapping("/{id}")
    public Object get(@PathVariable String id) {
        TenantContext.currentTenantId();
        throw new NoSuchElementException(
                "No form-definition repository exists in Flowable 8.0.0 (its standalone Form Engine was "
                        + "deprecated as of 7.0.1 -- see WorkflowWrapper.html Section 4/10). This endpoint needs a "
                        + "redesign against Flowable's process/case-level FormService before it can be real. "
                        + "Requested id '" + id + "' cannot exist until then.");
    }
}
