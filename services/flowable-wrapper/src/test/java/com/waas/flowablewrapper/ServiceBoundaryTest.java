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
 * flowable-wrapper is being split into microservices: design time (workflows,
 * versions, approvals) goes to design-service and login/members/groups go to
 * identity-service. That only works if the Flowable code never reaches into
 * those modules or their tables. Identity data must come through
 * {@code identity.IdentityDirectory}, the one seam that becomes an HTTP
 * client when identity-service is extracted. A violation here means the
 * extraction would break that code at runtime.
 */
class ServiceBoundaryTest {

    private static final Path ROOT = Path.of("src/main/java/com/waas/flowablewrapper");

    /** The packages that stay in flowable-wrapper after the split. */
    private static final List<String> FLOWABLE_PACKAGES = List.of("work", "deployment", "runtimeview");

    private static final Pattern FORBIDDEN_IMPORT =
            Pattern.compile("com\\.waas\\.flowablewrapper\\.(design|auth)\\b");

    /** Identity and design-time tables live in the public / app_auth schemas. */
    private static final Pattern FORBIDDEN_TABLE = Pattern.compile("\\b(public|app_auth)\\.[a-z_]+");

    @Test
    void flowableCodeDoesNotDependOnDesignOrAuthModules() throws IOException {
        assertThat(violations(FORBIDDEN_IMPORT))
                .as("work/deployment/runtimeview must not import design or auth (they move to other services)")
                .isEmpty();
    }

    @Test
    void flowableCodeReadsIdentityAndDesignDataOnlyThroughIdentityDirectory() throws IOException {
        assertThat(violations(FORBIDDEN_TABLE))
                .as("query identity data via IdentityDirectory; design tables are not flowable-wrapper's")
                .isEmpty();
    }

    private static List<String> violations(Pattern pattern) throws IOException {
        List<String> found = new ArrayList<>();
        int scanned = 0;
        for (String pkg : FLOWABLE_PACKAGES) {
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
