package com.waas.flowablewrapper;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

/**
 * flowable-wrapper owns only the Flowable engine and the {@code runtime}
 * schema. Identity data (users, roles, groups) belongs to identity-service
 * and design-time data (workflows, versions, approvals, audit) to
 * design-service; identity data reaches this service only through
 * {@code identity.IdentityDirectory}. Once each service has its own
 * database, any direct query on those tables here fails at runtime.
 */
class ServiceBoundaryTest {

    private static final Path ROOT = Path.of("src/main/java/com/waas/flowablewrapper");

    /** Every package in this service. */
    private static final List<String> PACKAGES = List.of("");

    /** Other services' schemas (identity, design, spend) and the legacy public / app_auth ones. */
    private static final Pattern FORBIDDEN_TABLE = Pattern.compile(
            "\\bidentity\\.(users|tenants|profiles|group_members|invites)\\b"
                    + "|\\bdesign\\.(workflows|workflow_versions|approval_requests|audit_logs)\\b"
                    + "|\\b(spend|public|app_auth)\\.[a-z_]+");

    /** The extracted modules must not come back. */
    private static final Pattern FORBIDDEN_IMPORT =
            Pattern.compile("com\\.waas\\.flowablewrapper\\.(design|auth)\\b");

    @Test
    void flowableWrapperDoesNotQueryIdentityOrDesignTables() throws IOException {
        assertThat(violations(FORBIDDEN_TABLE))
                .as("ask identity-service via IdentityDirectory; design tables belong to design-service")
                .isEmpty();
    }

    @Test
    void extractedDesignAndAuthModulesStayOut() throws IOException {
        assertThat(violations(FORBIDDEN_IMPORT)).isEmpty();
    }

    private static List<String> violations(Pattern pattern) throws IOException {
        List<String> found = new ArrayList<>();
        int scanned = 0;
        for (String pkg : PACKAGES) {
            Path dir = ROOT.resolve(pkg);
            assertThat(dir).as("boundary test scans " + dir + "; update it if the package moved").isDirectory();
            try (Stream<Path> files = Files.walk(dir)) {
                for (Path file : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                    scanned++;
                    List<String> lines = Files.readAllLines(file);
                    for (int i = 0; i < lines.size(); i++) {
                        String line = lines.get(i).trim();
                        if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) {
                            continue; // comments may mention the old design
                        }
                        if (pattern.matcher(line).find()) {
                            found.add(file + ":" + (i + 1) + "  " + line);
                        }
                    }
                }
            }
        }
        assertThat(scanned).as("scanned no Java files: the test would pass vacuously").isPositive();
        return found;
    }
}
