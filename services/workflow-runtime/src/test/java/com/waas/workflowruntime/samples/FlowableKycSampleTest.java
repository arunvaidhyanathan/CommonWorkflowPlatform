package com.waas.workflowruntime.samples;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.flowable.cmmn.api.CmmnHistoryService;
import org.flowable.cmmn.api.CmmnManagementService;
import org.flowable.cmmn.api.CmmnRuntimeService;
import org.flowable.cmmn.api.CmmnTaskService;
import org.flowable.cmmn.api.runtime.PlanItemDefinitionType;
import org.flowable.cmmn.api.runtime.PlanItemInstance;
import org.flowable.cmmn.engine.CmmnEngine;
import org.flowable.cmmn.engine.CmmnEngineConfiguration;
import org.flowable.common.engine.impl.interceptor.EngineConfigurationConstants;
import org.flowable.dmn.api.DmnDecisionService;
import org.flowable.dmn.engine.DmnEngineConfiguration;
import org.flowable.dmn.engine.configurator.DmnEngineConfigurator;
import org.flowable.job.api.Job;
import org.flowable.task.api.Task;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Runs the KYC samples in Designer/samples on the real Flowable 8 CMMN and
 * DMN engines (in-memory H2), so the samples stay proof that each OSS
 * capability they claim to show actually works. Each test names the business
 * rule it protects.
 */
class FlowableKycSampleTest {

    // -Dcwp.samples=<dir> runs the same checks on other copies (e.g. files re-saved by the Designer).
    private static final Path SAMPLES = Path.of(System.getProperty("cwp.samples", "../../Designer/samples"));

    private static CmmnEngine engine;
    private static CmmnRuntimeService runtime;
    private static CmmnTaskService tasks;
    private static CmmnHistoryService history;
    private static CmmnManagementService management;
    private static DmnDecisionService decisions;

    @BeforeAll
    static void deploySamples() throws IOException {
        CmmnEngineConfiguration config = CmmnEngineConfiguration.createStandaloneInMemCmmnEngineConfiguration();
        config.setJdbcUrl("jdbc:h2:mem:kyc-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");
        config.addConfigurator(new DmnEngineConfigurator());
        engine = config.buildCmmnEngine();
        runtime = engine.getCmmnRuntimeService();
        tasks = engine.getCmmnTaskService();
        history = engine.getCmmnHistoryService();
        management = engine.getCmmnManagementService();

        DmnEngineConfiguration dmn = (DmnEngineConfiguration) config.getEngineConfigurations()
                .get(EngineConfigurationConstants.KEY_DMN_ENGINE_CONFIG);
        decisions = dmn.getDmnDecisionService();

        try (InputStream in = Files.newInputStream(SAMPLES.resolve("kyc-risk-decisions.dmn"))) {
            dmn.getDmnRepositoryService().createDeployment().addInputStream("kyc-risk-decisions.dmn", in).deploy();
        }
        try (InputStream in = Files.newInputStream(SAMPLES.resolve("kyc-onboarding-case.cmmn"))) {
            engine.getCmmnRepositoryService().createDeployment().addInputStream("kyc-onboarding-case.cmmn", in).deploy();
        }
    }

    @AfterAll
    static void close() {
        engine.close();
    }

    private static Map<String, Object> applicant(String country, String product, long volume, boolean pep, String type) {
        Map<String, Object> vars = new HashMap<>();
        vars.put("country", country);
        vars.put("productType", product);
        vars.put("expectedMonthlyVolume", volume);
        vars.put("isPep", pep);
        vars.put("customerType", type);
        return vars;
    }

    private static Map<String, List<Map<String, Object>>> assess(Map<String, Object> applicant) {
        return decisions.createExecuteDecisionBuilder().decisionKey("kycAssessmentService")
                .variables(applicant).executeDecisionService();
    }

    private static List<Object> documents(Map<String, List<Map<String, Object>>> result) {
        return result.get("kycDocumentRequirements").stream().map(row -> row.get("requiredDocument")).toList();
    }

    // ---------------------------------------------------------------- DMN

    @Test
    void lowRiskIndividualGetsSimplifiedReviewAndBasicDocuments() {
        var result = assess(applicant("GB", "CURRENT_ACCOUNT", 5_000, false, "INDIVIDUAL"));

        assertThat(result.get("kycRiskTier").get(0))
                .containsEntry("riskTier", "LOW").containsEntry("reviewLevel", "SIMPLIFIED");
        // COLLECT: every matching row is returned, not just the first.
        assertThat(documents(result)).containsExactlyInAnyOrder("Government ID", "Proof of Address");
    }

    @Test
    void politicallyExposedPersonAlwaysNeedsEnhancedDueDiligence() {
        // Regulatory rule: PEP status overrides an otherwise low-risk profile.
        var result = assess(applicant("GB", "CURRENT_ACCOUNT", 5_000, true, "INDIVIDUAL"));

        assertThat(result.get("kycRiskTier").get(0))
                .containsEntry("riskTier", "HIGH").containsEntry("reviewLevel", "ENHANCED");
        assertThat(documents(result)).contains("Source of Wealth Statement");
    }

    @Test
    void sanctionedCountryIsHighRiskEvenWithTheCatchAllRow() {
        // FIRST: the specific country row wins over the "-" default below it.
        // (Encapsulated decisions can't be called by their own key, so this goes through the service.)
        var result = assess(applicant("IR", "CURRENT_ACCOUNT", 5_000, false, "INDIVIDUAL"));

        assertThat(result.get("kycRiskTier").get(0)).containsEntry("riskTier", "HIGH");
    }

    @Test
    void riskiestApplicableProductRuleDrivesTheTier() {
        // FIRST with rows ordered riskiest-first: private banking (HIGH) wins over
        // the 150k-volume MEDIUM row, and that HIGH reaches the dependent tier decision.
        var result = assess(applicant("GB", "PRIVATE_BANKING", 150_000, false, "CORPORATE"));

        assertThat(result.get("kycRiskTier").get(0)).containsEntry("riskTier", "HIGH");
        assertThat(documents(result)).containsExactlyInAnyOrder(
                "Certificate of Incorporation", "Beneficial Ownership Register", "Source of Wealth Statement");
    }

    @Test
    void mostFrequentApplicableMonitoringScheduleWins() {
        // PRIORITY: a low-risk corporate matches both QUARTERLY (corporate) and
        // ANNUAL (default); the ranked outputValues pick QUARTERLY.
        var lowCorporate = assess(applicant("GB", "CURRENT_ACCOUNT", 5_000, false, "CORPORATE"));
        assertThat(lowCorporate.get("kycMonitoringFrequency").get(0)).containsEntry("monitoringFrequency", "QUARTERLY");

        var highCorporate = assess(applicant("GB", "PRIVATE_BANKING", 5_000, false, "CORPORATE"));
        assertThat(highCorporate.get("kycMonitoringFrequency").get(0)).containsEntry("monitoringFrequency", "MONTHLY");

        var lowIndividual = assess(applicant("GB", "CURRENT_ACCOUNT", 5_000, false, "INDIVIDUAL"));
        assertThat(lowIndividual.get("kycMonitoringFrequency").get(0)).containsEntry("monitoringFrequency", "ANNUAL");
    }

    // ---------------------------------------------------------------- CMMN

    private static String startCase(Map<String, Object> applicant) {
        return runtime.createCaseInstanceBuilder().caseDefinitionKey("kycOnboardingCase")
                .variables(applicant).start().getId();
    }

    private static Task task(String caseId, String name) {
        return tasks.createTaskQuery().caseInstanceId(caseId).taskName(name).singleResult();
    }

    private static List<String> openTaskNames(String caseId) {
        return tasks.createTaskQuery().caseInstanceId(caseId).list().stream().map(Task::getName).toList();
    }

    private static String caseState(String caseId) {
        return history.createHistoricCaseInstanceQuery().caseInstanceId(caseId).singleResult().getState();
    }

    @Test
    void highRiskCaseGoesThroughEnhancedDueDiligenceBeforeApproval() {
        String caseId = startCase(applicant("IR", "CURRENT_ACCOUNT", 5_000, false, "INDIVIDUAL"));
        assertThat(openTaskNames(caseId)).containsExactly("Collect Customer Documents");

        tasks.complete(task(caseId, "Collect Customer Documents").getId());

        // The decision task stored the service result as one JSON variable; its tier drove the routing.
        assertThat(runtime.getVariable(caseId, "kycAssessmentService").toString())
                .contains("\"riskTier\":\"HIGH\"");
        assertThat(openTaskNames(caseId)).containsExactly("Source of Wealth Review");
        assertThat(task(caseId, "Source of Wealth Review").getFormKey()).isEqualTo("kyc-source-of-wealth");

        // Senior sign-off only opens after the wealth review (stage-internal sentry).
        tasks.complete(task(caseId, "Source of Wealth Review").getId());
        assertThat(openTaskNames(caseId)).containsExactly("Senior Compliance Sign-off");
        tasks.complete(task(caseId, "Senior Compliance Sign-off").getId());

        // The pending SLA timer does not hold the case open (autoComplete).
        assertThat(caseState(caseId)).isEqualTo("completed");
        assertThat(history.createHistoricMilestoneInstanceQuery().milestoneInstanceCaseInstanceId(caseId)
                .milestoneInstanceName("KYC Approved").count()).isEqualTo(1);
    }

    @Test
    void lowRiskCaseSkipsEnhancedDueDiligence() {
        String caseId = startCase(applicant("GB", "CURRENT_ACCOUNT", 5_000, false, "INDIVIDUAL"));
        tasks.complete(task(caseId, "Collect Customer Documents").getId());

        assertThat(openTaskNames(caseId)).containsExactly("Standard Review");
        tasks.complete(task(caseId, "Standard Review").getId());

        assertThat(caseState(caseId)).isEqualTo("completed");
    }

    @Test
    void analystCanRequestAdditionalDocumentsRepeatedlyBeforeTheStageCompletes() {
        String caseId = startCase(applicant("GB", "CURRENT_ACCOUNT", 5_000, false, "INDIVIDUAL"));

        // Manual activation + repetition: offered, not started, and available again after each use.
        for (int i = 1; i <= 2; i++) {
            PlanItemInstance offered = runtime.createPlanItemInstanceQuery().caseInstanceId(caseId)
                    .planItemInstanceName("Request Additional Document").planItemInstanceStateEnabled().singleResult();
            assertThat(offered).as("request #%d is offered", i).isNotNull();
            runtime.startPlanItemInstance(offered.getId());
            tasks.complete(task(caseId, "Request Additional Document").getId());
        }
        // Each request is its own tracked instance, numbered by the plan-item-local counter.
        assertThat(history.createHistoricPlanItemInstanceQuery().planItemInstanceCaseInstanceId(caseId)
                .planItemInstanceName("Request Additional Document").planItemInstanceState("completed").count())
                .isEqualTo(2);
        PlanItemInstance next = runtime.createPlanItemInstanceQuery().caseInstanceId(caseId)
                .planItemInstanceName("Request Additional Document").planItemInstanceStateEnabled().singleResult();
        assertThat(runtime.getLocalVariable(next.getId(), "additionalDocRequests")).isEqualTo(3);

        // The stage still waits for the required task; optional requests don't complete it.
        assertThat(openTaskNames(caseId)).containsExactly("Collect Customer Documents");
    }

    @Test
    void reviewSlaBreachCreatesAnEscalationTask() {
        String caseId = startCase(applicant("GB", "CURRENT_ACCOUNT", 5_000, false, "INDIVIDUAL"));
        Job timer = management.createTimerJobQuery().caseInstanceId(caseId).singleResult();
        assertThat(timer).as("the 5-day SLA timer is scheduled at case start").isNotNull();

        // Fire the timer now instead of waiting five days.
        Job executable = management.moveTimerToExecutableJob(timer.getId());
        management.executeJob(executable.getId());

        assertThat(openTaskNames(caseId)).contains("Escalate Overdue Review");
    }

    @Test
    void customerWithdrawalTerminatesTheCaseWithoutApproval() {
        String caseId = startCase(applicant("GB", "CURRENT_ACCOUNT", 5_000, false, "INDIVIDUAL"));
        PlanItemInstance withdraw = runtime.createPlanItemInstanceQuery().caseInstanceId(caseId)
                .planItemDefinitionType(PlanItemDefinitionType.USER_EVENT_LISTENER).singleResult();

        runtime.completeUserEventListenerInstance(withdraw.getId());

        assertThat(caseState(caseId)).isEqualTo("terminated");
        assertThat(history.createHistoricMilestoneInstanceQuery().milestoneInstanceCaseInstanceId(caseId).count())
                .isZero();
    }
}
