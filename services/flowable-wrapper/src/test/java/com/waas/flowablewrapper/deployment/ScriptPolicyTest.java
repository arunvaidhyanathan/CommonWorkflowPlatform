package com.waas.flowablewrapper.deployment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

/**
 * Scripts run arbitrary code in the shared runtime, so with scripts disabled
 * no way of writing one may slip through to an engine.
 */
class ScriptPolicyTest {

    @Test
    void everyScriptFormIsDetected() {
        assertThat(ScriptPolicy.containsScript("<scriptTask id='a' scriptFormat='groovy'/>")).isTrue();
        assertThat(ScriptPolicy.containsScript("<bpmn2:scriptTask id=\"a\">")).as("any namespace prefix").isTrue();
        assertThat(ScriptPolicy.containsScript("<task flowable:type=\"script\"/>")).as("CMMN script task").isTrue();
        assertThat(ScriptPolicy.containsScript("<flowable:executionListener event='start' type='script'>"))
                .as("script listener").isTrue();
        assertThat(ScriptPolicy.containsScript("<flowable:script language='groovy'>x</flowable:script>")).isTrue();
    }

    @Test
    void scriptFreeModelsPass() throws IOException {
        for (String sample : new String[] {"kyc-onboarding-case.cmmn", "kyc-risk-decisions.dmn", "customer-onboarding-process.bpmn"}) {
            String xml = Files.readString(Path.of("../../Designer/samples", sample));
            assertThat(ScriptPolicy.containsScript(xml)).as(sample).isFalse();
        }
    }

    @Test
    void disabledPlatformRefusesTheScriptedSampleAndEnabledAllowsIt() throws IOException {
        String xml = Files.readString(Path.of("../../Designer/samples/expense-claim-process.bpmn"));
        assertThatThrownBy(() -> ScriptPolicy.check("expenseClaim", xml, false))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("scripts are disabled");
        assertThatCode(() -> ScriptPolicy.check("expenseClaim", xml, true)).doesNotThrowAnyException();
    }
}
