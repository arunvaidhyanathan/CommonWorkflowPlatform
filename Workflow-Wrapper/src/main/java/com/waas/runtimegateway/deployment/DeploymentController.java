package com.waas.runtimegateway.deployment;

import java.net.URI;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

/**
 * WorkflowWrapper.html Section 8, row 1 ({@code POST /runtime/deployments}).
 * Deploy-authority enforcement (Governance Phase 4) happens inside {@link
 * DeploymentService}, not here -- the controller stays a thin HTTP
 * adapter, consistent with the rest of this service's "thin API layer"
 * framing (WorkflowWrapper.html Section 5).
 */
@RestController
@RequestMapping("/runtime/deployments")
public class DeploymentController {

    private final DeploymentService deploymentService;

    public DeploymentController(DeploymentService deploymentService) {
        this.deploymentService = deploymentService;
    }

    @PostMapping
    public ResponseEntity<DeploymentResponse> create(@Valid @RequestBody CreateDeploymentRequest request) {
        DeploymentResponse response = deploymentService.create(request);
        URI location = ServletUriComponentsBuilder.fromCurrentRequest()
                .path("/{id}")
                .buildAndExpand(response.id())
                .toUri();
        return ResponseEntity.created(location).body(response);
    }

    @GetMapping
    public List<DeploymentResponse> list() {
        return deploymentService.list();
    }

    @GetMapping("/{id}")
    public DeploymentResponse get(@PathVariable UUID id) {
        return deploymentService.get(id);
    }
}
