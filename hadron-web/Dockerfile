# =============================================================================
# Stage 1: Build Rust backend
# =============================================================================
FROM rust:1.83-slim-bookworm AS backend-builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Cache dependency build
COPY Cargo.toml Cargo.lock* ./
COPY crates/hadron-core/Cargo.toml crates/hadron-core/Cargo.toml
COPY crates/hadron-server/Cargo.toml crates/hadron-server/Cargo.toml

# Create dummy src files for dependency caching
RUN mkdir -p crates/hadron-core/src crates/hadron-server/src && \
    echo "pub fn dummy() {}" > crates/hadron-core/src/lib.rs && \
    echo "fn main() {}" > crates/hadron-server/src/main.rs

RUN cargo build --release --bin hadron-server 2>/dev/null || true

# Copy real source and build
COPY crates/ crates/
COPY migrations/ migrations/

# Touch source files to force rebuild with real code
RUN touch crates/hadron-core/src/lib.rs crates/hadron-server/src/main.rs

RUN cargo build --release --bin hadron-server

# =============================================================================
# Stage 2: Build frontend
# =============================================================================
FROM node:20-slim AS frontend-builder

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ .
ARG VITE_AUTH_MODE=dev
ENV VITE_AUTH_MODE=${VITE_AUTH_MODE}
RUN npm run build

# =============================================================================
# Stage 3: Runtime image
# =============================================================================
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*

RUN groupadd -r hadron && useradd -r -g hadron hadron

WORKDIR /app

# Copy backend binary
COPY --from=backend-builder /build/target/release/hadron-server ./hadron-server

# Copy frontend static assets
COPY --from=frontend-builder /build/dist ./static

# Copy migrations (for runtime migration)
COPY migrations/ ./migrations

USER hadron

EXPOSE 8080

ENV RUST_LOG=info
ENV STATIC_DIR=/app/static

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/api/health/live || exit 1

CMD ["./hadron-server"]
