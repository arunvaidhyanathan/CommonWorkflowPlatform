package com.waas.workflowruntime.deployment;

import java.util.regex.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Script tasks and script listeners run arbitrary code (Groovy) inside the
 * shared runtime JVM, with access to every tenant's data and the database
 * credentials. They are therefore a platform-level opt-in
 * ({@code cwp.scripts.enabled}, off by default): with scripts disabled, a
 * deployment containing any script is refused before it reaches an engine.
 */
final class ScriptPolicy {

    // <scriptTask>, flowable:type="script" (CMMN script task / listeners), scriptFormat="..." and <flowable:script>.
    private static final Pattern SCRIPT = Pattern.compile(
            "<(\\w+:)?scriptTask\\b|\\btype\\s*=\\s*[\"']script[\"']|\\bscriptFormat\\s*=|<(\\w+:)?script\\b",
            Pattern.CASE_INSENSITIVE);

    private ScriptPolicy() {
    }

    static boolean containsScript(String xml) {
        return xml != null && SCRIPT.matcher(xml).find();
    }

    static void check(String definitionKey, String xml, boolean scriptsEnabled) {
        if (!scriptsEnabled && containsScript(xml)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "'" + definitionKey
                    + "' contains a script task or script listener, and scripts are disabled on this platform"
                    + " (cwp.scripts.enabled). Scripts run inside the shared runtime, so a platform operator must enable them.");
        }
    }
}
