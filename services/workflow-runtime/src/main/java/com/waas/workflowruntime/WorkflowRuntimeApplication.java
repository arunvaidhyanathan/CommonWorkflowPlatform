package com.waas.workflowruntime;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Entry point for the Runtime Gateway -- CWP's Workflow Wrapper service.
 *
 * <p>See /Documents/WorkflowWrapper.html for the full architecture decision.
 * This service is a thin API layer today: every endpoint is real and backed
 * by the {@code runtime} schema in the shared Supabase Postgres project, but
 * there is no live Flowable engine behind it yet (Section 4 of that
 * document explains why). Nothing here should be mistaken for a fully
 * working workflow runtime -- the point is a stable, Flowable-shaped
 * contract the frontend and other CWP components can build against now,
 * with the real engine swapped in later without breaking that contract.
 */
@SpringBootApplication
public class WorkflowRuntimeApplication {

    public static void main(String[] args) {
        SpringApplication.run(WorkflowRuntimeApplication.class, args);
    }
}
