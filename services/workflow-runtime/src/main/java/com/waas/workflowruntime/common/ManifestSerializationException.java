package com.waas.workflowruntime.common;

/**
 * Wraps a Jackson (de)serialization failure when reading/writing a
 * deployment's {@code manifest_json} column (WorkflowWrapper.html Section
 * 9 Phase 2). Should only ever happen if the stored column somehow holds
 * malformed JSON -- application code always writes valid JSON into it --
 * so this is treated as a server error (500), not a client input problem.
 */
public class ManifestSerializationException extends RuntimeException {

    public ManifestSerializationException(String message, Throwable cause) {
        super(message, cause);
    }
}
