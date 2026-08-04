package com.waas.runtimegateway.common;

import java.time.OffsetDateTime;

/** Uniform error body for every non-2xx response this service returns. */
public record ApiError(String error, String message, OffsetDateTime timestamp) {

    public static ApiError of(String error, String message) {
        return new ApiError(error, message, OffsetDateTime.now());
    }
}
