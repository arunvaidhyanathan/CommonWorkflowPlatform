package com.waas.workflowruntime.samples;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import org.flowable.cmmn.api.CmmnTaskService;
import org.flowable.cmmn.engine.CmmnEngineConfiguration;
import org.flowable.cmmn.engine.configurator.CmmnEngineConfigurator;
import org.flowable.common.engine.impl.interceptor.EngineConfigurationConstants;
import org.flowable.dmn.engine.DmnEngineConfiguration;
import org.flowable.dmn.engine.configurator.DmnEngineConfigurator;
import org.flowable.engine.HistoryService;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.ProcessEngineConfiguration;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.engine.impl.cfg.ProcessEngineConfigurationImpl;
import org.flowable.engine.runtime.Execution;
import org.flowable.task.api.Task;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Runs the BPMN samples in Designer/samples on real Flowable 8 engines
 * (process + CMMN + DMN on in-memory H2, Groovy scripts, mail to an in-test
 * SMTP sink). Each test names the business rule it protects.
 */
class FlowableBpmnSampleTest {

    private static final Path SAMPLES = Path.of("../../Designer/samples");

    private static ProcessEngine engine;
    private static RuntimeService runtime;
    private static TaskService tasks;
    private static HistoryService history;
    private static CmmnTaskService cmmnTasks;
    private static SmtpSink smtp;

    @BeforeAll
    static void start() throws IOException {
        smtp = new SmtpSink();
        ProcessEngineConfigurationImpl config = (ProcessEngineConfigurationImpl)
                ProcessEngineConfiguration.createStandaloneInMemProcessEngineConfiguration();
        config.setJdbcUrl("jdbc:h2:mem:bpmn-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");
        config.setMailServerHost("localhost");
        config.setMailServerPort(smtp.port());
        config.setMailServerDefaultFrom("workflow@cwp.local");
        config.addConfigurator(new CmmnEngineConfigurator());
        config.addConfigurator(new DmnEngineConfigurator());
        engine = config.buildProcessEngine();
        runtime = engine.getRuntimeService();
        tasks = engine.getTaskService();
        history = engine.getHistoryService();
        CmmnEngineConfiguration cmmn = (CmmnEngineConfiguration) config.getEngineConfigurations()
                .get(EngineConfigurationConstants.KEY_CMMN_ENGINE_CONFIG);
        DmnEngineConfiguration dmn = (DmnEngineConfiguration) config.getEngineConfigurations()
                .get(EngineConfigurationConstants.KEY_DMN_ENGINE_CONFIG);
        cmmnTasks = cmmn.getCmmnTaskService();

        try (InputStream in = Files.newInputStream(SAMPLES.resolve("kyc-risk-decisions.dmn"))) {
            dmn.getDmnRepositoryService().createDeployment().addInputStream("kyc-risk-decisions.dmn", in).deploy();
        }
        try (InputStream in = Files.newInputStream(SAMPLES.resolve("kyc-onboarding-case.cmmn"))) {
            cmmn.getCmmnRepositoryService().createDeployment().addInputStream("kyc-onboarding-case.cmmn", in).deploy();
        }
        for (String file : List.of("expense-claim-process.bpmn", "customer-onboarding-process.bpmn")) {
            try (InputStream in = Files.newInputStream(SAMPLES.resolve(file))) {
                engine.getRepositoryService().createDeployment().addInputStream(file.replace(".bpmn", ".bpmn20.xml"), in)
                        .deploy();
            }
        }
    }

    @AfterAll
    static void stop() throws IOException {
        engine.close();
        smtp.close();
    }

    @BeforeEach
    void clearMail() {
        smtp.messages.clear();
    }

    // ------------------------------------------------------------ expense claim

    private static String startClaim(int amount, List<String> reviewers) {
        Map<String, Object> vars = new HashMap<>();
        vars.put("amount", amount);
        vars.put("employeeEmail", "employee@example.com");
        vars.put("reviewers", reviewers);
        return runtime.startProcessInstanceByKey("expenseClaim", vars).getId();
    }

    private static void review(String processId, String reviewer, String vote) {
        Task task = tasks.createTaskQuery().processInstanceId(processId).taskAssignee(reviewer).singleResult();
        assertThat(task).as("peer review for %s", reviewer).isNotNull();
        tasks.complete(task.getId(), Map.of("vote", vote));
    }

    private static boolean ended(String processId) {
        return history.createHistoricProcessInstanceQuery().processInstanceId(processId).singleResult().getEndTime() != null;
    }

    private static Object historicVariable(String processId, String name) {
        var v = history.createHistoricVariableInstanceQuery().processInstanceId(processId).variableName(name).singleResult();
        return v == null ? null : v.getValue();
    }

    @Test
    void everyReviewerGetsTheirOwnTaskAndEachVoteIsCollected() {
        String id = startClaim(100, List.of("ana", "ben"));
        // Parallel multi-instance: one task per reviewer, assigned by the element variable.
        assertThat(tasks.createTaskQuery().processInstanceId(id).list()).extracting(Task::getAssignee)
                .containsExactlyInAnyOrder("ana", "ben");

        review(id, "ana", "approve");
        review(id, "ben", "approve");

        // Variable aggregation: both votes, each with its reviewer, in one variable.
        String reviews = String.valueOf(historicVariable(id, "reviews"));
        assertThat(reviews).contains("\"reviewer\":\"ana\"").contains("\"reviewer\":\"ben\"").contains("\"vote\":\"approve\"");
    }

    @Test
    void approvedClaimEmailsTheEmployeeAndKeepsTheBudgetReserved() {
        String id = startClaim(100, List.of("ana", "ben"));
        review(id, "ana", "approve");
        review(id, "ben", "approve");

        assertThat(ended(id)).isTrue();
        assertThat(historicVariable(id, "budgetReserved")).isEqualTo(true);
        assertThat(smtp.messages).hasSize(1);
        assertThat(smtp.messages.get(0)).contains("employee@example.com").contains("Expense claim approved")
                .contains("Your expense claim for 100 was approved.");
    }

    @Test
    void oneRejectionReleasesTheReservedBudgetThroughCompensation() {
        String id = startClaim(100, List.of("ana", "ben"));
        review(id, "ana", "approve");
        review(id, "ben", "reject");

        assertThat(ended(id)).isTrue();
        assertThat(historicVariable(id, "approved")).isEqualTo(false);
        // Compensation ran "Release Budget", undoing "Reserve Budget".
        assertThat(historicVariable(id, "budgetReserved")).isEqualTo(false);
        assertThat(history.createHistoricActivityInstanceQuery().processInstanceId(id).activityId("release").count())
                .isEqualTo(1);
        assertThat(smtp.messages).isEmpty();
    }

    @Test
    void largeClaimEscalatesToADirectorWithoutStoppingTheApproval() {
        String id = startClaim(6000, List.of("ana"));
        review(id, "ana", "approve");

        // Non-interrupting escalation: the director task opens, the claim still proceeds and pays.
        Task director = tasks.createTaskQuery().processInstanceId(id).taskName("Director Sign-off").singleResult();
        assertThat(director).isNotNull();
        assertThat(tasks.getIdentityLinksForTask(director.getId())).anyMatch(l -> "tenant_admin".equals(l.getGroupId()));
        assertThat(smtp.messages).hasSize(1);
        assertThat(ended(id)).as("waits for the director sign-off").isFalse();

        tasks.complete(director.getId());
        assertThat(ended(id)).isTrue();
    }

    @Test
    void smallClaimNeedsNoDirector() {
        String id = startClaim(100, List.of("ana"));
        review(id, "ana", "approve");
        assertThat(history.createHistoricTaskInstanceQuery().processInstanceId(id).taskName("Director Sign-off").count())
                .isZero();
    }

    @Test
    void withdrawingTheClaimCancelsOpenReviews() {
        String id = startClaim(100, List.of("ana", "ben"));
        runtime.signalEventReceived("claimWithdrawn",
                runtime.createExecutionQuery().processInstanceId(id).signalEventSubscriptionName("claimWithdrawn")
                        .singleResult().getId());

        assertThat(ended(id)).isTrue();
        assertThat(historicVariable(id, "withdrawn")).isEqualTo(true);
        assertThat(tasks.createTaskQuery().processInstanceId(id).count()).isZero();
        assertThat(smtp.messages).isEmpty();
    }

    // ------------------------------------------------------- customer onboarding

    @Test
    void onboardingRunsTheKycCaseThenAdHocSetupThenWaitsForReviewAndCall() {
        Map<String, Object> applicant = new HashMap<>();
        applicant.put("country", "GB");
        applicant.put("productType", "CURRENT_ACCOUNT");
        applicant.put("expectedMonthlyVolume", 5000);
        applicant.put("isPep", false);
        applicant.put("customerType", "INDIVIDUAL");
        String id = runtime.startProcessInstanceByKey("customerOnboarding", applicant).getId();

        // Case service task: the KYC case was started with the applicant's data and the process waits.
        Task collect = cmmnTasks.createTaskQuery().taskName("Collect Customer Documents").singleResult();
        assertThat(collect).isNotNull();
        cmmnTasks.complete(collect.getId());
        cmmnTasks.complete(cmmnTasks.createTaskQuery().taskName("Standard Review").singleResult().getId());

        // Case done: its result came back out, and the ad-hoc account setup is open with nothing started.
        assertThat(String.valueOf(runtime.getVariable(id, "kycResult"))).contains("\"riskTier\":\"LOW\"");
        Execution adhoc = runtime.createExecutionQuery().processInstanceId(id).activityId("accountSetup").singleResult();
        assertThat(runtime.getEnabledActivitiesFromAdhocSubProcess(adhoc.getId()))
                .extracting(a -> a.getId()).containsExactlyInAnyOrder("orderCard", "onlineBanking", "overdraft");
        assertThat(tasks.createTaskQuery().processInstanceId(id).count()).isZero();

        // Start two of the three; the completion condition needs card + online banking, not the overdraft.
        runtime.executeActivityInAdhocSubProcess(adhoc.getId(), "orderCard");
        runtime.executeActivityInAdhocSubProcess(adhoc.getId(), "onlineBanking");
        tasks.complete(tasks.createTaskQuery().processInstanceId(id).taskDefinitionKey("orderCard").singleResult().getId(),
                Map.of("cardOrdered", true));
        assertThat(runtime.createExecutionQuery().processInstanceId(id).activityId("accountSetup").count())
                .as("still waiting for online banking").isEqualTo(1);
        tasks.complete(tasks.createTaskQuery().processInstanceId(id).taskDefinitionKey("onlineBanking").singleResult().getId(),
                Map.of("onlineBankingReady", true));

        // Conditional event: waits until riskReviewed is true.
        assertThat(runtime.getActiveActivityIds(id)).containsExactly("awaitRiskReview");
        runtime.setVariable(id, "riskReviewed", true);
        runtime.evaluateConditionalEvents(id);
        assertThat(runtime.getActiveActivityIds(id)).containsExactly("awaitWelcomeCall");

        // Variable listener event: fires as soon as welcomeCallDone is written.
        runtime.setVariable(id, "welcomeCallDone", true);
        assertThat(ended(id)).isTrue();
    }

    /** Minimal SMTP server that accepts every message and keeps its raw text. */
    static final class SmtpSink implements AutoCloseable {
        final List<String> messages = new CopyOnWriteArrayList<>();
        private final ServerSocket server;

        SmtpSink() throws IOException {
            server = new ServerSocket(0);
            Thread t = new Thread(this::serve, "smtp-sink");
            t.setDaemon(true);
            t.start();
        }

        int port() {
            return server.getLocalPort();
        }

        private void serve() {
            while (!server.isClosed()) {
                try (Socket s = server.accept();
                        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                        PrintWriter out = new PrintWriter(s.getOutputStream(), true, StandardCharsets.UTF_8)) {
                    out.print("220 sink\r\n");
                    out.flush();
                    StringBuilder message = new StringBuilder();
                    String line;
                    while ((line = in.readLine()) != null) {
                        String cmd = line.toUpperCase();
                        if (cmd.startsWith("DATA")) {
                            out.print("354 go\r\n");
                            out.flush();
                            while ((line = in.readLine()) != null && !line.equals(".")) {
                                message.append(line).append('\n');
                            }
                            messages.add(message.toString());
                            message.setLength(0);
                            out.print("250 ok\r\n");
                        } else if (cmd.startsWith("QUIT")) {
                            out.print("221 bye\r\n");
                            out.flush();
                            break;
                        } else {
                            if (cmd.startsWith("RCPT")) {
                                message.append(line).append('\n');
                            }
                            out.print("250 ok\r\n");
                        }
                        out.flush();
                    }
                } catch (IOException e) {
                    // closed or client gone; keep serving until close()
                }
            }
        }

        @Override
        public void close() throws IOException {
            server.close();
        }
    }
}
