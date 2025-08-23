# Multi-stage build for security and optimization
FROM node:22-slim AS base
WORKDIR /app

# Stage 1: Build environment with all dependencies
FROM base AS builder

# Install build dependencies and security updates
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    ca-certificates \
    wget \
    gnupg \
    unzip \
    # Chrome dependencies
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libxss1 \
    libasound2 \
    # Firefox dependencies
    libgtk-3-0 \
    libdbus-glib-1-2 \
    libxt6 \
    libsm6 \
    libice6 \
    # Additional X11 and font dependencies
    xvfb \
    fonts-liberation \
    libappindicator3-1 \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/* /var/tmp/*

# Install Google Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Install Firefox
RUN apt-get update \
    && apt-get install -y firefox-esr \
    && rm -rf /var/lib/apt/lists/*

# Install UV for Python package management globally
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Install Playwright and browsers globally
RUN npm install -g playwright \
    && playwright install chromium firefox webkit \
    && playwright install-deps

# Note: SuperGateway will be installed via npx on-demand to avoid dependency issues

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY src/ ./src/

# Stage 2: Runtime environment (minimal)
FROM node:22-slim AS runtime

# Install only essential runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    python3-pip \
    ca-certificates \
    # Minimal Chrome runtime deps
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libxss1 \
    libasound2 \
    # Clean up
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/* /var/tmp/*

# Create app directory
WORKDIR /app

# Create secure directories including all paths needed by the application
RUN mkdir -p /config /var/log/mcp-proxy-manager /app/tmp && \
    chmod 1777 /app/tmp
    # Set ownership for mcpuser after user creation (done later)

# Copy production dependencies and application from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package*.json ./

# Copy UV and global tools from builder
COPY --from=builder /root/.local/bin/uv /usr/local/bin/
COPY --from=builder /root/.local/bin/uvx /usr/local/bin/
COPY --from=builder /usr/local/lib/node_modules/playwright /usr/local/lib/node_modules/playwright
COPY --from=builder /usr/local/bin/playwright /usr/local/bin/

# Create non-root user with security hardening
RUN groupadd -r mcpgroup && \
    useradd -r -g mcpgroup -m -s /bin/bash mcpuser && \
    # Setup directories with proper ownership and logging permissions
    chown -R mcpuser:mcpgroup /app /config /var/log/mcp-proxy-manager && \
    chmod 755 /var/log/mcp-proxy-manager && \
    # Set permissions for UV tools
    chmod 755 /usr/local/bin/uv /usr/local/bin/uvx && \
    # Create user directories (standard practice)
    mkdir -p /home/mcpuser/.local/bin && \
    mkdir -p /home/mcpuser/.local/share/uv/tools && \
    mkdir -p /home/mcpuser/.cache/uv && \
    mkdir -p /home/mcpuser/.cache/npm && \
    mkdir -p /home/mcpuser/.cache/playwright && \
    mkdir -p /home/mcpuser/.config && \
    # Link UV tools  
    ln -s /usr/local/bin/uv /home/mcpuser/.local/bin/uv && \
    ln -s /usr/local/bin/uvx /home/mcpuser/.local/bin/uvx && \
    # Set ownership for all mcpuser directories
    chown -R mcpuser:mcpgroup /home/mcpuser && \
    # Set secure permissions
    chmod -R 755 /home/mcpuser && \
    chmod -R 700 /home/mcpuser/.cache && \
    chmod -R 700 /home/mcpuser/.local/share && \
    chmod 755 /var/log/mcp-proxy-manager

# Install MCPO as mcpuser so it's executable without needing root paths
# Pin to latest version to get SSE timeout fixes (v0.0.17+)
RUN su -s /bin/bash -c "uv tool install mcpo>=0.0.17" mcpuser

# Set environment variables with defaults
ENV NODE_ENV=production
ENV MANAGER_PORT=3001
ENV CLAUDE_CONFIG_PATH=/config/claude_desktop_config.json
ENV MCP_PROXY_TYPE=mcpo
ENV PORT_RANGE_START=50000
ENV PORT_RANGE_END=50300
ENV PATH="/home/mcpuser/.local/bin:$PATH"
# Cache directories - use user home directory (best practice)
ENV UV_CACHE_DIR=/home/mcpuser/.cache/uv
ENV UV_TOOL_DIR=/home/mcpuser/.local/share/uv/tools
ENV NPM_CONFIG_CACHE=/home/mcpuser/.cache/npm
ENV PLAYWRIGHT_BROWSERS_PATH=/home/mcpuser/.cache/playwright
ENV NPM_CONFIG_TMP=/app/tmp
ENV TMPDIR=/app/tmp

# Expose ports (SIGNIFICANTLY expanded for multi-transport)
EXPOSE 3001
EXPOSE 50000-50300

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Switch to mcpuser
USER mcpuser

# Start the application
CMD ["npm", "start"]