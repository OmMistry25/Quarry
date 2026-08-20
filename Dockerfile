# Quarry, as a long-running container.
#
# Deliberately not a serverless target: the pipeline shells out to `claude`, `gitleaks`, git
# and the generated package's own toolchain, needs a writable `work/` that outlives a single
# request, and spends 8-12 minutes inside one HTTP call.

FROM node:22-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter core build && pnpm --filter web build


FROM node:22-bookworm-slim AS runner

# git      — S1 clones the repository under assessment
# python3  — S6 verifies generated Python packages, each in its own venv
# ca-certs — cloning and installing over TLS
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates curl git python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/*

# gitleaks: S6 fails a run outright when it is missing rather than skipping the scan, which
# is the correct behaviour and makes this line load-bearing.
ARG GITLEAKS_VERSION=8.21.2
RUN curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
    | tar -xz -C /usr/local/bin gitleaks \
  && gitleaks version

# The agent stages run `claude -p --output-format json`.
RUN npm install -g @anthropic-ai/claude-code && claude --version

WORKDIR /app
RUN corepack enable
COPY --from=builder /app /app

# Run directories live on the mounted volume, not the container's ephemeral layer: the run id
# handed to the browser by /api/map has to still resolve when /api/generate asks for it.
ENV QUARRY_WORK_DIR=/data/work
ENV NODE_ENV=production
RUN mkdir -p /data/work

EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]
