# Hadron Desktop Features

**Version**: v1.1.0+
**Last Updated**: 2025-11-14

This document provides a comprehensive overview of all Hadron Desktop features, including current capabilities and planned enhancements.

---

## Table of Contents

1. [Core Features](#core-features)
2. [Multi-Provider AI Support](#multi-provider-ai-support)
3. [Offline Operation (Ollama)](#offline-operation-ollama)
4. [Analysis & Translation](#analysis--translation)
5. [History & Search](#history--search)
6. [Batch Processing](#batch-processing)
7. [Security & Privacy](#security--privacy)
8. [Desktop Experience](#desktop-experience)
9. [Future Features](#future-features)

---

## Core Features

### Intelligent Crash Analysis
- **AI-powered root cause detection** for VisualWorks Smalltalk crash logs
- **Automatic severity classification** (critical, high, medium, low)
- **Suggested fixes** with code examples and prevention tips
- **Stack trace explanation** in plain language
- **Component identification** (which class/module failed)
- **Confidence scoring** for analysis quality

### Cost Tracking
- Real-time cost estimation per analysis
- Cumulative cost tracking across providers
- Per-provider cost breakdown
- Token usage monitoring
- Export cost reports

---

## Multi-Provider AI Support

Hadron Desktop supports six AI providers, giving you flexibility for cloud, hybrid, or 100% offline operation:

### 1. OpenAI
**Models**: GPT-5.1, GPT-4 Turbo, GPT-4, GPT-3.5 Turbo

**Pricing**:
- GPT-4 Turbo: ~$0.01-$0.03/analysis
- GPT-3.5 Turbo: ~$0.001-$0.002/analysis

**Best For**: Occasional use, variable workload, maximum accuracy

### 2. Anthropic (Claude)
**Models**: Claude Sonnet 4.5, Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku

**Features**:
- 200K token context window
- Excellent reasoning for complex crashes
- Multiple tier options (speed vs cost)

**Pricing**:
- Claude Sonnet 4.5: ~$0.003-$0.015/analysis
- Claude 3 Haiku: ~$0.00025-$0.00125/analysis

**Best For**: Large crash logs, detailed analysis, cost-effective option (Haiku)

### 3. Z.ai (GLM-4.6)
**Pricing**: Flat $3/month (unlimited analyses)

**Best For**: High-volume analysis, predictable costs, budget teams

### 4. Ollama (Local Models)
**Models**: Llama 3.2, Llama 3, Mistral, CodeLlama, Qwen, etc.

**Features**:
- 100% offline operation
- Zero cost (unlimited analyses)
- Data stays on device
- No API key required

**Requirements**:
- Ollama installed (`http://127.0.0.1:11434`)
- Model pulled locally (default: `llama3.2:3b`)

**Best For**: Privacy-sensitive work, offline environments, zero-cost operation

### 5. vLLM (High-Performance Server)
**Features**:
- Self-hosted inference server
- GPU acceleration support
- Batch processing optimization

**Best For**: Enterprise teams, high-volume processing, GPU infrastructure

### 6. llama.cpp (Efficient C++ Inference)
**Features**:
- CPU-optimized inference
- Low memory footprint
- Quantized model support

**Best For**: Resource-constrained environments, CPU-only servers

---

## Provider Resilience

### Circuit Breaker Pattern
- **Automatic failover** when primary provider fails
- **Health monitoring** with real-time status indicators
- **Error rate tracking** (opens circuit at 50% error rate)
- **Auto-recovery** after 60s timeout

### Provider Configuration
- Enable/disable providers individually
- Set primary provider preference
- Configure fallback order
- Model selection per provider

---

## Offline Operation (Ollama)

Complete implementation for 100% offline crash analysis:

### Features
- **No internet required** for analysis
- **No API key required**
- **Zero cost** (unlimited analyses)
- **Data privacy** (never leaves device)
- **Rust-native implementation** (no Python overhead)

### Setup
```bash
# 1. Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull default model
ollama pull llama3.2:3b

# 3. Start Ollama (if not running)
ollama serve
```

### Supported Models
- `llama3.2:3b` (default - lightweight, 2GB)
- `llama3.2:1b` (ultra-light, 1.3GB)
- `llama3:8b` (more capable, 4.7GB)
- `codellama:7b` (optimized for code analysis)
- Any model in `ollama list`

### Performance
| Hardware | Crash Log Size | Analysis Time |
|----------|----------------|---------------|
| M1 Mac   | 5KB            | ~8s           |
| M1 Mac   | 50KB           | ~15s          |
| Intel i7 | 5KB            | ~12s          |
| Intel i7 | 50KB           | ~25s          |

**See**: [OLLAMA-IMPLEMENTATION.md](./OLLAMA-IMPLEMENTATION.md) for complete technical details.

---

## Analysis & Translation

### Crash Log Analysis
**Input**: VisualWorks Smalltalk crash log (any size)

**Output**:
- Error type classification
- Severity assessment
- Root cause explanation
- Stack trace breakdown
- Suggested fixes (3-5 actionable items)
- Prevention tips
- Component identification
- Confidence score

### Technical Translation
Convert technical jargon to plain language for non-technical stakeholders:

**Features**:
- Translate crash analysis to business language
- Explain technical concepts simply
- Preserve accuracy while simplifying
- Export as Markdown/PDF for sharing

**Use Cases**:
- Stakeholder reports
- Management updates
- Customer communications
- Documentation

---

## History & Search

### Local Database (SQLite)
- **FTS5 full-text search** across all analyses
- **BM25 ranking** for search relevance
- **Instant search** with highlighting
- **Persistent storage** (never lose work)

### Search Features
- Search by error type, message, root cause
- Filter by provider, model, date range
- Favorites system (star important analyses)
- Recent files quick access
- Sort by date, relevance, cost

### Export
- Export individual analyses to Markdown/PDF
- Export search results
- Batch export multiple analyses
- Include cost reports

---

## Batch Processing

Process multiple crash logs simultaneously:

### Features
- **Drag & drop multiple files**
- **Parallel analysis** (configurable concurrency)
- **Progress tracking** with real-time updates
- **Error handling** (failures don't block other files)
- **Batch export** of all results

### Use Cases
- Daily crash log processing
- Regression testing
- Automated analysis pipelines
- Historical log analysis

---

## Security & Privacy

### API Key Security
- **OS-level encryption**:
  - macOS: Keychain
  - Windows: Credential Manager
  - Linux: Secret Service API
- **Never stored in plain text**
- **Auto-clear on logout** (optional)

### PII Redaction (Optional)
- **Automatic detection** of personally identifiable information
- **Redact before sending to AI** provider
- **Preserve analysis accuracy**
- **Configurable sensitivity**

**Redacted**:
- Email addresses
- IP addresses
- File paths (optional)
- User IDs (optional)
- Timestamps (optional)

### Permissions
Following the **principle of least privilege**:
- ✅ Dialog (file selection only)
- ✅ Store (settings persistence only)
- ✅ Notification (update alerts only)
- ✅ Updater (auto-updates only)
- ❌ Shell access (removed)
- ❌ Filesystem access (removed)

### Content Security Policy
- Strict CSP headers
- No inline scripts
- No eval() usage
- Allowlist deny by default

---

## Desktop Experience

### User Interface
- **Dark mode** (eye-friendly for long sessions)
- **Drag & drop** file upload
- **Syntax highlighting** for stack traces
- **Responsive design** (resize-friendly)
- **Keyboard shortcuts** (coming soon)

### File Handling
- Support for `.txt`, `.log`, `.crash` files
- Automatic crash log detection
- Recent files history
- File size validation

### Updates
- **Auto-updater** with one-click installation
- **Update notifications** in-app
- **Release notes** displayed automatically
- **Rollback** to previous version (manual)

### Logging
- **Structured logging** (JSON + human-readable)
- **Log rotation** (automatic cleanup)
- **Error reporting** (local only, no telemetry)
- **Debug mode** for troubleshooting

---

## Future Features

All future features follow the **YAGNI principle** - implemented based on user feedback, not speculation.

### Planned (v1.2+)

#### 1. End-to-End Testing
**Status**: Deferred until regression bugs reported
**Estimated Effort**: 5 hours

Automated E2E testing with Playwright for critical workflows.

#### 2. Keyboard Shortcuts
**Status**: Waiting for user requests
**Estimated Effort**: 2 hours

Common shortcuts (Ctrl+N for new analysis, Ctrl+F for search, etc.)

#### 3. Custom Ollama Endpoint
**Status**: Planned (user request received)
**Estimated Effort**: 1 hour

Allow users to specify remote Ollama server URLs.

#### 4. Model Auto-Pull (Ollama)
**Status**: Planned
**Estimated Effort**: 2 hours

Detect missing models and offer automatic download.

#### 5. Performance Metrics
**Status**: Deferred
**Estimated Effort**: 3 hours

Track and display inference speed, memory usage, etc.

#### 6. Custom Fine-Tuned Models
**Status**: Under consideration
**Estimated Effort**: 8 hours

Support for domain-specific fine-tuned models (Smalltalk-optimized).

### Under Consideration

- **Team collaboration** (shared analysis history)
- **CI/CD integration** (automated crash log processing)
- **Mobile companion app** (view analyses on phone)
- **Cloud sync** (optional backup of analyses)
- **Advanced filtering** (regex, custom queries)
- **Trend analysis** (crash patterns over time)

### Not Planned

- **Real-time monitoring** (use dedicated APM tools)
- **Source code integration** (IDE plugins better suited)
- **Automated fixing** (too risky without human review)

---

## Feature Requests

Have an idea? Submit a feature request:

1. Check [existing issues](https://github.com/hadron-team/hadron-desktop/issues)
2. Open new issue with "Feature Request" label
3. Describe use case and value proposition
4. Include mockups/examples if applicable

**Decision criteria**:
- ✅ Requested by 2+ users
- ✅ Solves real pain point
- ✅ Aligns with product vision
- ✅ Reasonable implementation effort
- ❌ Over-engineering
- ❌ Speculative/no validation

---

## Documentation

- [User Guide](./docs/user/USER-GUIDE.md) - Getting started and basic usage
- [Troubleshooting](./TROUBLESHOOTING.md) - Common issues and solutions
- [Changelog](./CHANGELOG.md) - Release history
- [Developer Guides](./docs/developer/) - Technical implementation details

---

*Last updated: 2025-11-14*
