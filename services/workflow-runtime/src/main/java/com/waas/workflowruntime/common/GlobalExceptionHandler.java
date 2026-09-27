package com.waas.workflowruntime.common;

import java.util.NoSuchElementException;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

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
