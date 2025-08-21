# MCP OpenWebUI Docker Orchestrator

A Docker-based MCP management platform with dual-mode architecture, automated health monitoring, and simple setup. Runs MCP servers in isolated containers with a web dashboard for monitoring and control.

Built to work with your existing Claude Desktop configuration - just drop in your config file and run. Supports both unified and individual proxy modes depending on your needs.

[![Docker Pulls](https://img.shields.io/docker/pulls/casistack/mcp-openwebui-orchestrator)](https://hub.docker.com/r/casistack/mcp-openwebui-orchestrator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub issues](https://img.shields.io/github/issues/casistack/mcp-openwebui-orchestrator)](https://github.com/casistack/mcp-openwebui-orchestrator/issues)


## ✨ Key Features

### 🎯 **Dual-Mode Architecture** 

- **🔗 Unified Mode**: Single MCPO process with route-based access (`/graphiti`, `/memory`, etc.)
- **⚙️ Individual Mode**: Separate proxy processes for each MCP server (traditional approach)
- **🔄 Mode Switching**: Change modes via `MCP_PROXY_MODE` environment variable
- **✅ Zero Regression**: Individual mode preserved with all existing functionality

### 🚀 **Zero Configuration Complexity**

- **Drop-in Integration**: Uses your existing `claude_desktop_config.json`
- **Automatic Detection**: Intelligently identifies stdio vs SSE servers
- **Hot Reloading**: Configuration changes detected and applied in real-time
- **Mode Detection**: Automatically adapts dashboard and endpoints based on selected mode

### 🔧 **Intelligent Proxy Management**

- **MCPO Native Config**: Unified mode leverages MCPO's native Claude Desktop config support
- **Multi-Proxy Support**: MCPO and MCP-Bridge with automatic fallback (individual mode)
- **Robust Fallback Logic**: Prevents infinite loops with attempt tracking
- **Port Management**: Dynamic allocation from configurable pools
- **Process Lifecycle**: Graceful start/stop/restart with cleanup

### 📊 **Advanced Monitoring & Health Checks**

- **Real-time Dashboard**: Beautiful web interface at `/dashboard`
- **Comprehensive Health Monitoring**: MCPO-specific endpoint checks
- **Auto-restart**: Failed servers restart automatically with limits
- **Authentication Detection**: Handles external service auth requirements
- **Performance Metrics**: Response times, uptime tracking

### 🌐 **OpenWebUI Integration**

- **One-Click Setup**: Copy-paste endpoint URLs from dashboard
- **RESTful APIs**: OpenAPI-compatible endpoints for all MCP tools
- **Management API**: Full REST API for monitoring and control
- **Production Ready**: Docker-based with comprehensive logging

### 🔒 **Security Features**

- **Encrypted Configuration**: AES-256-GCM encryption for sensitive config data
- **Secure Logging**: Automatic masking of API keys, tokens, and credentials in logs
- **Configuration Validation**: Security recommendations and input validation
- **Rate Limiting**: Built-in API rate limiting protection
- **Memory Monitoring**: Resource usage tracking with configurable alerts


## 🚀 Setup 

Quick setup guide:

### Prerequisites

- 🐳 **Docker & Docker Compose** 
- 📁 **Claude Desktop config file** (optional - can use example)
- 🌐 **OpenWebUI instance** (local or remote)
- ⚡ **Node.js ≥18.0.0 and npm ≥8.0.0** (for local development)

### Choose Your Mode

| Mode | Best For | Description |
|------|----------|-------------|
| **🔗 Unified** | Most users, production | Single MCPO process, route-based (`/graphiti`, `/memory`) |
| **⚙️ Individual** | Development, debugging | Separate processes per server (port-based) |

**🔄 Easy Mode Switching**: Change `MCP_PROXY_MODE` in your `.env` file or docker-compose.yml and restart

### Docker Setup

```bash
# 1. Clone and enter directory
git clone https://github.com/casistack/mcp-openwebui-docker-orchestrator
cd mcp-openwebui-docker-orchestrator

# 2. Drop your config (or use sample)
cp ~/.config/Claude/claude_desktop_config.json ./config/
# OR use example: cp ./config/claude_desktop_config.json.example ./config/claude_desktop_config.json

# 3. Optional: Customize settings (copy and edit .env file)
cp .env.example .env && nano .env

# 4. One command to rule them all 
docker-compose up -d --build

# 5. Open dashboard - you're done!
open http://localhost:3001/dashboard
```

Your MCP tools are now running with health monitoring, auto-restart, and a web dashboard.

### Option 1: Unified Mode (Recommended)

Perfect for production with clean route-based URLs:

```bash
# After basic setup above, access routes:
open http://localhost:4200/graphiti/docs
open http://localhost:4200/memory/docs
# All tools available at http://localhost:4200/{toolname}/
```

### Switching Between Modes

You can easily switch between unified and individual modes:

#### Method 1: Using .env File (Recommended)
```bash
# Edit your .env file
echo "MCP_PROXY_MODE=individual" > .env
# OR
echo "MCP_PROXY_MODE=unified" > .env

# Restart containers
docker-compose down && docker-compose up -d
```

#### Method 2: Direct Environment Variable
```bash
# Set individual mode
export MCP_PROXY_MODE=individual
docker-compose up -d --build

# Set unified mode  
export MCP_PROXY_MODE=unified
docker-compose up -d --build
```

#### Method 3: Edit docker-compose.yml
```yaml
environment:
  - MCP_PROXY_MODE=individual  # Change this line
  # OR
  - MCP_PROXY_MODE=unified     # Change this line
```

### Option 2: Individual Mode Details

Traditional approach with separate ports per server:

```bash
# After switching to individual mode above:
# Access dashboard
open http://localhost:3001/dashboard

# Access individual server endpoints
open http://localhost:4200/docs  # First server
open http://localhost:4201/docs  # Second server
```

### Option 3: Docker Run Commands

For standalone deployment without docker-compose:

#### Unified Mode:
```bash
docker run -d \
  --name mcp-proxy-manager \
  -p 3001:3001 \
  -p 4200:4200 \
  -v ~/.config/Claude/claude_desktop_config.json:/config/claude_desktop_config.json:ro \
  -v ./logs:/var/log/mcp-proxy-manager \
  -e MCP_PROXY_MODE=unified \
  -e MANAGER_PORT=3001 \
  -e PORT_RANGE_START=4200 \
  -e PORT_RANGE_END=4300 \
  mcp-proxy-manager:latest
```

#### Individual Mode:
```bash
docker run -d \
  --name mcp-proxy-manager \
  -p 3001:3001 \
  -p 4200-4300:4200-4300 \
  -v ~/.config/Claude/claude_desktop_config.json:/config/claude_desktop_config.json:ro \
  -v ./logs:/var/log/mcp-proxy-manager \
  -e MCP_PROXY_MODE=individual \
  -e MANAGER_PORT=3001 \
  -e PORT_RANGE_START=4200 \
  -e PORT_RANGE_END=4300 \
  mcp-proxy-manager:latest
```

### Option 3: Add to Existing Docker Setup

Integrate with your existing infrastructure:

```yaml
version: "3.8"
services:
  mcp-proxy-manager:
    image: your-registry/mcp-proxy-manager:latest
    container_name: mcp-proxy-manager
    ports:
      - "3001:3001" # Management API & Dashboard
      - "4200-4300:4200-4300" # MCP proxy ports
    volumes:
      - ~/.config/Claude/claude_desktop_config.json:/config/claude_desktop_config.json:ro
      - ./logs:/var/log/mcp-proxy-manager
    environment:
      - MCP_PROXY_TYPE=mcpo
      - PORT_RANGE_START=4200
      - PORT_RANGE_END=4300
      - MANAGER_PORT=3001
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## 📊 Web Dashboard

### Access & Features

**URL**: `http://localhost:3001/dashboard`

The dashboard provides:

- **📈 Real-time Statistics**: Server count, health status, average response times
- **🖥️ Server Grid**: Individual server status with health indicators
- **🔗 OpenWebUI Integration**: One-click copy URLs for external API setup
- **📱 Mobile Responsive**: Works perfectly on all device sizes
- **🔄 Auto-refresh**: Updates every 10 seconds with toggle control

### Dashboard Sections

1. **Statistics Overview**

   - Total servers configured
   - Healthy vs unhealthy count
   - Average response times
   - Port utilization

2. **Server Status Grid**

   - Health status badges (Healthy/Unhealthy/Auth Required)
   - Port assignments and proxy types
   - Uptime and restart counters
   - Direct links to OpenAPI specs and docs
   - Fallback usage indicators

3. **OpenWebUI Integration Panel**
   - Healthy endpoint URLs ready for copying
   - Updated setup instructions for current interface
   - Management API endpoints
   - Copy-to-clipboard functionality

## 🔧 Configuration

### Environment Variables

| Variable             | Default                              | Description                             |
| -------------------- | ------------------------------------ | --------------------------------------- |
| `MCP_PROXY_MODE`     | `unified`                            | **Mode**: `unified` or `individual`    |
| `MANAGER_PORT`       | `3001`                               | Management API and dashboard port       |
| `CLAUDE_CONFIG_PATH` | `/config/claude_desktop_config.json` | Path to Claude Desktop config file      |
| `MCP_PROXY_TYPE`     | `mcpo`                               | Default proxy: `mcpo` or `mcp-bridge` (individual mode) |
| `PORT_RANGE_START`   | `4200`                               | Start of port allocation range          |
| `PORT_RANGE_END`     | `4300`                               | End of port allocation range            |

### Mode Comparison

| Feature | Unified Mode | Individual Mode |
|---------|--------------|-----------------|
| **MCPO Processes** | 1 | N (one per server) |
| **URL Pattern** | `/graphiti`, `/memory` | `:4200`, `:4201` |
| **Port Usage** | 1 port (4200) | N ports (4200+) |
| **Resource Usage** | Lower | Higher |
| **Debugging** | Single process logs | Per-server logs |
| **Production** | ✅ Recommended | ⚙️ Dev/Testing |

### Supported MCP Server Configurations

#### stdio-based Servers (Require Proxy)

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"]
    },
    "custom-server": {
      "command": "uvx",
      "args": ["your-custom-mcp-server"],
      "env": {
        "API_KEY": "your-api-key"
      },
      "proxyType": "mcp-bridge"
    }
  }
}
```

#### SSE Servers (Direct Connection)

```json
{
  "mcpServers": {
    "hosted-server": {
      "transport": "sse",
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  }
}
```

### Per-Server Proxy Configuration

Override the default proxy type per server:

```json
{
  "mcpServers": {
    "openbb": {
      "command": "uvx",
      "args": ["--from", "openbb-mcp-server", "openbb-mcp"],
      "proxyType": "mcp-bridge"
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"],
      "proxyType": "mcpo"
    }
  }
}
```

**Fallback Behavior**:

- **No `proxyType` specified**: Tries default → automatic fallback to alternate
- **Explicit `proxyType`**: Respects choice, no automatic fallback
- **Infinite Loop Prevention**: Maximum 3 attempts per server with attempt tracking

**MCP-Bridge vs MCPO**:

- **MCPO**: Lightweight, fast startup, ideal for simple MCP servers
- **MCP-Bridge**: Robust fallback for complex servers with FastMCP schemas that cause MCPO parsing errors
- **Automatic Fallback**: System intelligently switches from MCPO to MCP-Bridge when schema parsing fails
- **OpenWebUI Compatible**: Both provide full REST/OpenAPI endpoints required by OpenWebUI

## 🔗 OpenWebUI Integration

### Method 1: Dashboard Integration (Recommended)

1. **Access MCP Dashboard**: `http://localhost:3001/dashboard`
2. **Copy Endpoint URLs**: Use copy buttons in "OpenWebUI Integration" panel
3. **Configure OpenWebUI** (choose your method):
   
   **Option A: User Settings (Personal Tools)**
   - Go to **Settings** (user profile menu)
   - Navigate to **Tools** section
   - Add each copied URL as an external tool server
   
   **Option B: Admin Settings (Global Tools)**
   - Go to **Admin Panel** → **Settings**
   - Look for **Tools** or **External** section
   - Add URLs to make tools available system-wide
   
   **Option C: Model-Specific (Per-Model Tools)**
   - Go to **Workspace** → **Models**
   - Edit target model → **Tools** section
   - Configure which tools are enabled for this model
   
4. **Verify**: MCP tools appear in OpenWebUI chat interface

### Method 2: API Integration

Get endpoint list programmatically:

```bash
curl http://localhost:3001/openapi-endpoints
```

Example responses:

#### Unified Mode:
```json
{
  "mode": "unified",
  "endpoints": [
    {
      "name": "graphiti",
      "url": "http://localhost:4200/graphiti",
      "openapi_url": "http://localhost:4200/graphiti/openapi.json",
      "docs_url": "http://localhost:4200/graphiti/docs",
      "proxyType": "unified-mcpo"
    },
    {
      "name": "memory",
      "url": "http://localhost:4200/memory",
      "openapi_url": "http://localhost:4200/memory/openapi.json",
      "docs_url": "http://localhost:4200/memory/docs",
      "proxyType": "unified-mcpo"
    }
  ],
  "count": 13,
  "instructions": {
    "openwebui": "Add these route-based URLs as External OpenAPI servers",
    "format": "Each route provides OpenAPI-compatible REST API via unified MCPO"
  }
}
```

#### Individual Mode:
```json
{
  "mode": "individual",
  "endpoints": [
    {
      "name": "brave-search",
      "url": "http://localhost:4200",
      "openapi_url": "http://localhost:4200/openapi.json",
      "docs_url": "http://localhost:4200/docs",
      "proxyType": "mcpo"
    },
    {
      "name": "memory",
      "url": "http://localhost:4201",
      "openapi_url": "http://localhost:4201/openapi.json",
      "docs_url": "http://localhost:4201/docs",
      "proxyType": "mcpo"
    }
  ],
  "count": 10,
  "instructions": {
    "openwebui": "Add these URLs as External OpenAPI servers",
    "format": "Each endpoint provides OpenAPI-compatible REST API"
  }
}
```

## 📊 Management API

### Health & Status Endpoints

- `GET /health` - Service health check
- `GET /status` - Comprehensive system status with proxy details
- `GET /servers` - List all MCP servers with current status
- `GET /dashboard` - Web dashboard interface

### Server Management

- `POST /servers/{id}/restart` - Restart specific server
- `POST /servers/{id}/stop` - Stop specific server
- `POST /servers/{id}/start` - Start specific server
- `GET /servers/{id}/health` - Detailed server health statistics

### Configuration Management

- `GET /config` - View current configuration and server list
- `POST /config/reload` - Reload configuration file changes
- `GET /openapi-endpoints` - OpenWebUI-ready endpoint list
- `GET /ports` - Port allocation status and statistics

### Example API Usage

```bash
# Check overall system status (both modes)
curl http://localhost:3001/status | jq

# Get OpenWebUI endpoints (mode-aware)
curl http://localhost:3001/openapi-endpoints | jq '.endpoints[].url'

# Mode-specific examples:

# Unified Mode - Test route-based access
curl http://localhost:4200/graphiti/docs
curl http://localhost:4200/memory/tools
curl -X POST http://localhost:4200/graphiti/search_memory_nodes \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}'

# Individual Mode - Test separate ports
curl http://localhost:4200/docs  # First server
curl http://localhost:4201/docs  # Second server
curl -X POST http://localhost:3001/servers/memory/restart

# Management (both modes)
curl http://localhost:3001/servers/memory/health | jq
```

## 🧪 Testing Your Setup

### Quick Mode Test

```bash
# Test unified mode
curl -s http://localhost:3001/status | jq -r '.mode'
# Should return: "unified"

# Test individual mode  
# (after changing MCP_PROXY_MODE=individual and restarting)
curl -s http://localhost:3001/status | jq -r '.mode'
# Should return: "individual"
```

### Functional Testing

#### Unified Mode Testing:
```bash
# Test main dashboard
curl -f http://localhost:3001/dashboard

# Test route-based endpoints
curl -f http://localhost:4200/docs
curl -f http://localhost:4200/graphiti/docs
curl -f http://localhost:4200/memory/tools

# Test tool functionality
curl -X POST http://localhost:4200/graphiti/search_memory_nodes \
  -H "Content-Type: application/json" \
  -d '{"query": "test search"}'
```

#### Individual Mode Testing:
```bash
# Test main dashboard
curl -f http://localhost:3001/dashboard

# Test port-based endpoints
curl -f http://localhost:4200/docs  # First server
curl -f http://localhost:4201/docs  # Second server

# Test individual server control
curl -X POST http://localhost:3001/servers/memory/restart
```

## 🔍 Monitoring & Observability

### Real-time Monitoring

```bash
# System overview
curl http://localhost:3001/status

# Server-specific health
curl http://localhost:3001/servers/memory/health

# Port allocations
curl http://localhost:3001/ports

# Configuration status
curl http://localhost:3001/config
```

### Comprehensive Logging

```bash
# Container logs (all servers)
docker-compose logs -f mcp-proxy-manager

# Server-specific logs
docker-compose logs mcp-proxy-manager | grep "brave-search"

# Health monitoring alerts
tail -f logs/alerts.log

# Follow real-time health checks
docker-compose logs -f mcp-proxy-manager | grep "Health Report"
```

### Health Check System

**Automated Health Monitoring**:

- ✅ **Interval**: Every 30 seconds
- 🔄 **Auto-restart**: Failed servers restart automatically
- 📊 **Metrics**: Response times, failure rates, consecutive failures
- 🚨 **Alerting**: Configurable thresholds with severity levels
- 🔐 **Auth Detection**: Handles external authentication requirements

**Health Status Indicators**:

- 🟢 **Healthy**: Server responding to health checks
- 🔴 **Unhealthy**: Server failed health checks (will auto-restart)
- 🟡 **Auth Required**: Server needs external authentication/API keys

## 🛠️ Troubleshooting

### Common Issues & Solutions

#### Configuration Problems

```bash
# Verify config file mounting
docker-compose exec mcp-proxy-manager ls -la /config/

# Check configuration parsing
curl http://localhost:3001/config

# Reload configuration
curl -X POST http://localhost:3001/config/reload
```

#### Server Startup Issues

```bash
# Check specific server logs
docker-compose logs mcp-proxy-manager | grep "server-name"

# View server status
curl http://localhost:3001/servers | jq '.[] | select(.id=="server-name")'

# Manually restart server
curl -X POST http://localhost:3001/servers/server-name/restart
```

#### Port & Network Issues

```bash
# Check port allocations
curl http://localhost:3001/ports

# Verify proxy health
curl http://localhost:4200/openapi.json

# Test specific proxy endpoint
curl http://localhost:4201/docs
```

#### Health Check Failures

```bash
# Detailed health statistics
curl http://localhost:3001/servers/server-name/health

# Check authentication requirements
curl http://localhost:3001/status | jq '.proxies[] | select(.authError==true)'

# View failure patterns
grep "ALERT" logs/alerts.log
```

### Performance Optimization

#### Resource Limits

```yaml
services:
  mcp-proxy-manager:
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: "1.0"
        reservations:
          memory: 512M
          cpus: "0.5"
```

#### Scaling Considerations

- **Port Range**: Adjust `PORT_RANGE_START/END` for server count
- **Memory Usage**: ~50-100MB per active MCP server
- **CPU Usage**: Minimal overhead with efficient health checking
- **Network**: Each server uses one port in the configured range



## 🚀 Advanced Features

### Robust Fallback System

- **Intelligent Proxy Selection**: MCPO → MCP-Bridge automatic fallback for complex schemas
- **Attempt Tracking**: Prevents infinite fallback loops
- **Port Cleanup**: 10-second delays prevent port reuse conflicts
- **Maximum Retries**: Configurable limits per server (default: 3)
- **Graceful Degradation**: Unhealthy servers marked but kept running
- **Schema Compatibility**: Handles FastMCP 2.11.3+ complex schemas via MCP-Bridge

### Authentication Handling

- **External API Detection**: Recognizes HTTP 401 authentication errors
- **Smart Retry Logic**: Doesn't infinitely retry auth failures
- **Status Indicators**: Clear dashboard indicators for auth requirements

### Performance Optimization

- **Async Operations**: Non-blocking health checks and server management
- **Efficient Monitoring**: Batched health checks with configurable intervals
- **Resource Management**: Proper cleanup on server shutdown
- **Memory Optimization**: Bounded history tracking and log rotation

## 🚀 Quick Start

```bash
git clone https://github.com/casistack/mcp-openwebui-orchestrator
cd mcp-openwebui-orchestrator && cp ~/.config/Claude/claude_desktop_config.json ./config/
docker-compose up -d --build && open http://localhost:3001/dashboard
```

## 🙏 Built With & Credits

This project builds on excellent existing technologies:

### Core Technologies
- **[MCPO](https://github.com/open-webui/mcpo)** - MCP-to-OpenAPI proxy server by Open WebUI team
- **[MCP-Bridge](https://github.com/SecretiveShell/MCP-Bridge)** - Alternative MCP proxy by SecretiveShell  
- **[Supergateway](https://github.com/open-webui/supergateway)** - Universal API gateway fallback
- **[OpenWebUI](https://github.com/open-webui/open-webui)** - ChatGPT-like web interface
- **[Model Context Protocol](https://modelcontextprotocol.io/)** - Anthropic's protocol for AI tool integration

### What We Added
- **Docker Orchestration** - Complete containerized deployment  
- **Health Monitoring** - Real-time process monitoring with auto-restart
- **Dual-Mode Architecture** - Choose unified or individual proxy approaches
- **Management Dashboard** - Web interface for monitoring and control
- **Dynamic Port Management** - Automatic port allocation and conflict resolution
- **Zero-Config Setup** - Drop your Claude Desktop config and run

**💡 Philosophy**: We believe in standing on the shoulders of giants. This project combines excellent existing tools with orchestration, monitoring, and a great user experience - all running safely in Docker containers.

## 🤝 Contributing

We welcome contributions to improve MCP Proxy Manager!

### Development Environment Setup

```bash
# Clone repository
git clone https://github.com/casistack/mcp-openwebui-orchestrator
cd mcp-openwebui-orchestrator/mcp-proxy-manager

# Install dependencies
npm install

# Security audit
npm run security-check

# Development mode with hot reload
npm run dev

# Run tests
npm test

# Build production image
docker build -t mcp-proxy-manager .
```

### Contribution Guidelines

1. **Fork** the repository
2. **Create** feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** changes (`git commit -m 'Add amazing feature'`)
4. **Test** thoroughly with various MCP servers
5. **Push** branch (`git push origin feature/amazing-feature`)
6. **Open** Pull Request with detailed description

### Code Quality

- ESLint configuration for consistent code style
- Comprehensive error handling and logging
- Unit tests for core functionality
- Docker best practices and security scanning

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.
