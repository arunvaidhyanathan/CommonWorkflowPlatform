package com.waas.flowablewrapper.common;

import java.util.NoSuchElementException;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/**
 * Centralized so every controller returns the same {@link ApiError} shape
 * instead of Spring's default (and inconsistent) error payloads.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(DeployAuthorityDeniedException.class)
    public ResponseEntity<ApiError> handleDeployAuthorityDenied(DeployAuthorityDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ApiError.of("deploy_authority_denied", ex.getMessage()));
    }

    @ExceptionHandler(NoSuchElementException.class)
    public ResponseEntity<ApiError> handleNotFound(NoSuchElementException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiError.of("not_found", ex.getMessage()));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<ApiError> handleIllegalState(IllegalStateException ex) {
        // TenantContext throws this when there is no authenticated JWT --
        // should be unreachable given SecurityConfig requires auth on
        // /runtime/**, but fail loudly rather than as a 500 if it happens.
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ApiError.of("unauthenticated", ex.getMessage()));
    }

    @ExceptionHandler(UnsupportedSpecTypeException.class)
    public ResponseEntity<ApiError> handleUnsupportedSpecType(UnsupportedSpecTypeException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiError.of("unsupported_spec_type", ex.getMessage()));
    }

    @ExceptionHandler(ManifestSerializationException.class)
    public ResponseEntity<ApiError> handleManifestSerialization(ManifestSerializationException ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiError.of("manifest_serialization_error", ex.getMessage()));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiError> handleResponseStatus(ResponseStatusException ex) {
        HttpStatus status = HttpStatus.valueOf(ex.getStatusCode().value());
        return ResponseEntity.status(status)
                .body(ApiError.of(status.name().toLowerCase(), ex.getReason()));
    }

    // Unique keys (definition key, username) and FKs (deleting a workflow that
    // still has approval requests) surface as 409 with a readable message.
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiError> handleDataIntegrity(DataIntegrityViolationException ex) {
        Throwable cause = ex.getMostSpecificCause();
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiError.of("conflict", cause.getMessage()));
    }

    // Engine errors (unknown definition key, a refused expression, a failing script) are the
    // request's fault, not a server crash: say what the engine said.
    @ExceptionHandler(org.flowable.common.engine.api.FlowableObjectNotFoundException.class)
    public ResponseEntity<ApiError> handleEngineNotFound(org.flowable.common.engine.api.FlowableObjectNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of("not_found", ex.getMessage()));
    }

    @ExceptionHandler(org.flowable.common.engine.api.FlowableException.class)
    public ResponseEntity<ApiError> handleEngine(org.flowable.common.engine.api.FlowableException ex) {
        Throwable root = ex;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        String detail = root == ex ? ex.getMessage() : ex.getMessage() + " -- " + root.getMessage();
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(ApiError.of("engine_error", detail));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(fieldError -> fieldError.getField() + ": " + fieldError.getDefaultMessage())
                .orElse("Validation failed");
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiError.of("validation_error", message));
    }
}
