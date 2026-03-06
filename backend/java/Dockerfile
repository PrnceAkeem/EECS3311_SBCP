# =============================================================================
# backend/java/Dockerfile — Multi-stage build for the Java HTTP backend
# =============================================================================
#
# STAGE 1 (builder): Use a full JDK + Maven image to compile the source and
#   package a self-contained "fat jar" via maven-shade-plugin.
#   The fat jar bundles the PostgreSQL JDBC driver so no extra classpath is
#   needed at runtime.
#
# STAGE 2 (runtime): Copy only the finished jar into a slim JRE image.
#   This keeps the final image small (~200 MB vs ~600 MB for a full JDK).
#
# BUILD CONTEXT: set to the repo root in docker-compose.yml so the build can
#   access backend/java/. The COPY instructions below use paths relative to
#   the build context (repo root), not relative to this Dockerfile.
#
# RESULT: a container that runs the Java HTTP server on port 8080.
# =============================================================================

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM maven:3.9-eclipse-temurin-17-alpine AS builder

# Working directory inside the builder container
WORKDIR /build

# Copy the Maven descriptor first — Docker caches this layer separately so
# "mvn dependency:go-offline" is only re-run when pom.xml changes, not on
# every source-code edit.
COPY backend/java/pom.xml .

# Download all declared dependencies into the local Maven cache.
# --batch-mode suppresses interactive prompts for CI-friendliness.
RUN mvn dependency:go-offline --batch-mode

# Copy the full Java source tree (src/) into the builder.
COPY backend/java/src ./src

# Compile and package into a single fat jar.
#   -DskipTests: we have no unit tests yet — remove this flag in Phase 2.
#   Result: target/synergy-booking-1.0.0.jar
RUN mvn package --batch-mode -DskipTests

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre-alpine AS runtime

# Non-root user for least-privilege security best practice.
RUN addgroup -S synergy && adduser -S synergy -G synergy
USER synergy

WORKDIR /app

# Copy only the finished fat jar from the builder stage — no JDK, no Maven.
COPY --from=builder /build/target/synergy-booking-1.0.0.jar app.jar

# Expose the port the Java HttpServer listens on (matches Server.java PORT=8080).
EXPOSE 8080

# DATABASE_URL is injected by docker-compose.yml at container startup.
# It must be set before this command runs or the server will fall back to
# jdbc:postgresql://localhost:5432/synergy (fine for local dev, not for Docker).
ENTRYPOINT ["java", "-jar", "app.jar"]
