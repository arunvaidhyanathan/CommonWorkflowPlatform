package com.waas.runtimegateway.common;

/**
 * Thrown when a manifest artifact's {@code specType} doesn't match any
 * engine this service knows how to deploy to (BPMN, CMMN, DMN) --
 * WorkflowWrapper.html Section 9 Phase 7. A client input problem, not a
 * server error, so it maps to 400 in {@link GlobalExceptionHandler}.
 */
public class UnsupportedSpecTypeException extends RuntimeException {

    public UnsupportedSpecTypeException(String message) {
        super(message);
    }
}
