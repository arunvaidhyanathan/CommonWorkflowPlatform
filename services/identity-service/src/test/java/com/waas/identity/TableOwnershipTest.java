package com.waas.identity;

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
 * Workflows, versions, approvals and the audit log belong to design-service;
 * identity-service records its audit events through DesignAudit. With each
 * service on its own database role and schema (database/00-roles.sql), a direct query on
 * those tables here fails with "permission denied".
 */
class TableOwnershipTest {

    private static final Path ROOT = Path.of("src/main/java/com/waas/identity");

    private static final Pattern DESIGN_TABLE =
            Pattern.compile("\\bdesign\\.(workflows|workflow_versions|approval_requests|audit_logs)\\b"
                    + "|\\b(runtime|spend|public|app_auth)\\.[a-z_]+");

    @Test
    void identityServiceDoesNotQueryDesignOrRuntimeTables() throws IOException {
        List<String> found = new ArrayList<>();
        int scanned = 0;
        try (Stream<Path> files = Files.walk(ROOT)) {
            for (Path file : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                scanned++;
                List<String> lines = Files.readAllLines(file);
                for (int i = 0; i < lines.size(); i++) {
                    String line = lines.get(i).trim();
                    if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) {
                        continue;
                    }
                    if (DESIGN_TABLE.matcher(line).find()) {
                        found.add(file + ":" + (i + 1) + "  " + line);
                    }
                }
            }
        }
        assertThat(scanned).as("scanned no Java files: the test would pass vacuously").isPositive();
        assertThat(found).as("record audit events via DesignAudit; design tables are design-service's").isEmpty();
    }
}
