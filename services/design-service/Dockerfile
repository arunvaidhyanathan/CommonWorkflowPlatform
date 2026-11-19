# design-service: workflows, versions, approvals, audit (Java 21 / Spring Boot 4).
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/design-service-*.jar app.jar
# Runs as any UID in group 0 (OpenShift restricted SCC); the jar is read-only.
USER 1001
# Size the heap from the container's memory limit; restart on OOM instead of limping.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
EXPOSE 8083
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
