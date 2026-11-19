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
 * own database role (Database/roles.sql), any direct query on those tables
 * here fails with "permission denied".
 */
class TableOwnershipTest {

    private static final Path ROOT = Path.of("src/main/java/com/waas/design");

    private static final Pattern IDENTITY_TABLE =
            Pattern.compile("\\b(app_auth\\.[a-z_]+|public\\.(profiles|group_members|invites|tenants))\\b");

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
                    if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) {
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
