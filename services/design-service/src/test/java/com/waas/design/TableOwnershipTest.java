package com.waas.design;

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
 * Users, profiles, groups, invites and tenants belong to identity-service;
 * design-service asks it through IdentityClient. Once each service gets its
 * own database, any direct query on those tables here breaks. The one known
 * exception is the audit log's actor email, which must be resolved before
 * the database split.
 */
class TableOwnershipTest {

    private static final Path ROOT = Path.of("src/main/java/com/waas/design");

    private static final Pattern IDENTITY_TABLE =
            Pattern.compile("\\b(app_auth\\.[a-z_]+|public\\.(profiles|group_members|invites|tenants))\\b");

    /** Known cross-service read, to remove at the database split (Phase 3). */
    private static final String AUDIT_ACTOR_EMAIL_JOIN = "left join public.profiles p on p.id = a.actor_id";

    @Test
    void designServiceDoesNotQueryIdentityTables() throws IOException {
        List<String> found = new ArrayList<>();
        int scanned = 0;
        try (Stream<Path> files = Files.walk(ROOT)) {
            for (Path file : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                scanned++;
                List<String> lines = Files.readAllLines(file);
                for (int i = 0; i < lines.size(); i++) {
                    String line = lines.get(i).trim();
                    if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")
                            || line.contains(AUDIT_ACTOR_EMAIL_JOIN)) {
                        continue;
                    }
                    if (IDENTITY_TABLE.matcher(line).find()) {
                        found.add(file + ":" + (i + 1) + "  " + line);
                    }
                }
            }
        }
        assertThat(scanned).as("scanned no Java files: the test would pass vacuously").isPositive();
        assertThat(found).as("ask identity-service (IdentityClient) instead of reading its tables").isEmpty();
    }
}
