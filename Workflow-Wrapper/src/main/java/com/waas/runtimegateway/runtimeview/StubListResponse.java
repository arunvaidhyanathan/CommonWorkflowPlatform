// SUPERSEDED (WorkflowWrapper.html Section 9 Phase 7): this generic
// "empty list + explanatory note" wrapper was used by CaseInstanceController
// and TaskInstanceHistoryController while both were stubs with no real
// engine behind them. Flowable 8.0.0 is now embedded for real (see
// DeploymentService, CaseInstanceController, TaskInstanceHistoryController),
// so both controllers return real, unwrapped lists instead. Nothing in this
// project references this type anymore. Deletion failed in this sandbox
// (mounted-folder restriction) -- this file is intentionally left with no
// class declaration (a package statement plus comments is a valid, empty
// Java compilation unit) so it does not affect the build. Safe to delete
// by hand.
package com.waas.runtimegateway.runtimeview;
