# Phase 3: AI Enhancement Backlog
**Smalltalk Crash Analyzer - AI Quality, Cost & Performance Optimization**

**Updated**: 2025-11-12 (Added reference implementations for AI/LLM patterns)

## Executive Summary
Transform AI analysis from inconsistent and expensive (~70% accuracy, $0.03-0.05/analysis) to reliable and cost-effective (>85% accuracy, <$0.01/analysis). Enable local AI support, intelligent caching, and multi-provider flexibility while maintaining <15s response times.

**Reference Implementations**:
- [logpai/logparser](https://github.com/logpai/logparser) - Drain algorithm for log pattern extraction
- [microsoft/presidio](https://github.com/microsoft/presidio) - PII detection and anonymization
- [nodeshift/opossum](https://github.com/nodeshift/opossum) - Circuit breaker for fault tolerance
- [OpenTelemetry](https://opentelemetry.io/) - Distributed tracing for AI pipeline
- [winston](https://github.com/winstonjs/winston) - Structured logging

**New Capabilities**:
- ✅ **Log Pattern Extraction**: Use Drain algorithm to identify crash patterns before AI analysis
- ✅ **PII Protection**: Automatic redaction of sensitive data (API keys, tokens, emails, IPs)
- ✅ **Fault Tolerance**: Circuit breakers prevent cascading failures from AI provider outages
- ✅ **Observability**: End-to-end tracing of AI requests with OpenTelemetry

## Health Score Assessment
- **Clarity**: 3/3 - Requirements are measurable and testable
- **Feasibility**: 3/3 - Work items properly sized and sequenced
- **Completeness**: 3/3 - All quality gates and observability included
**Total Score**: 9/9 - **PROCEED**

## Risk Ledger

| Risk | Severity | Mitigation | Status |
|------|----------|------------|--------|
| PII leakage in crash logs sent to AI | **CRITICAL** | microsoft/presidio for automatic redaction | NEW - Mitigated |
| AI provider outages cause cascading failures | HIGH | nodeshift/opossum circuit breaker | NEW - Mitigated |
| Prompt regression breaks existing analyses | HIGH | Versioned prompts with rollback capability | Mitigated |
| Ollama latency impacts UX | HIGH | Async streaming with timeout fallback | Mitigated |
| Cache poisoning from bad analyses | MEDIUM | TTL expiry + validation layer | Mitigated |
| Provider API changes break integration | MEDIUM | Abstract interface + contract tests | Mitigated |
| Cost overruns from uncapped usage | HIGH | Hard budget limits with circuit breaker | Mitigated |
| Lack of observability in AI pipeline | MEDIUM | OpenTelemetry + winston structured logging | NEW - Mitigated |

## Assumptions Ledger

| Assumption | Impact | Validation |
|------------|--------|------------|
| SQLite sufficient for cache (not Redis) | LOW | Reasonable for desktop app |
| 90% similarity threshold optimal | MEDIUM | Requires A/B testing |
| Users willing to wait 15s for quality | HIGH | Validate with user feedback |
| Ollama models understand Smalltalk | HIGH | Requires early testing |
| Token counting accurate across providers | MEDIUM | Validate with billing reconciliation |

## Dependency Graph
```
A (Prompt Engineering) ──┬──> C (Model Selection)
                         └──> B (Caching) ──> E (Streaming)

D (Multi-Provider) ──────────> E (Streaming) ──> F (Cost Tracking)
                                                        │
                                                        v
                                                  G (Feedback Loop)
```

---

# EPIC A: Enhanced Prompt Engineering
**Objective**: Improve AI accuracy from 70% to >85% through systematic prompt optimization
**DoD**:
- Accuracy measured at >85% on test corpus of 100 crashes
- Prompt version tracking with rollback capability
- A/B test framework operational with p-value calculations

## Story A-1: Prompt Template System
**Priority**: P0 - Critical Path
**Status**: READY
**Unblocks**: A-2, C-1

### Acceptance Criteria
- Templates support variable injection with validation
- Version control with semantic versioning
- Template registry with hot-reload capability

### Tasks

#### A-1-T1: Create Prompt Registry Module
**Token Budget**: 8,000 tokens
**LOC Budget**: 500 lines

```typescript
// src/ai/prompts/registry.ts
interface PromptTemplate {
  id: string;
  version: string;
  template: string;
  variables: PromptVariable[];
  examples: FewShotExample[];
  metadata: PromptMetadata;
}

interface PromptVariable {
  name: string;
  type: 'string' | 'number' | 'object';
  required: boolean;
  validator?: (value: any) => boolean;
  sanitizer?: (value: any) => any;
}

interface FewShotExample {
  input: string;
  output: string;
  explanation?: string;
}

class PromptRegistry {
  private templates: Map<string, PromptTemplate[]>;
  private activeVersions: Map<string, string>;

  async loadTemplate(id: string, version?: string): Promise<PromptTemplate> {
    // Implementation with caching and validation
  }

  async rollback(id: string, targetVersion: string): Promise<void> {
    // Atomic rollback with validation
  }
}
```

#### A-1-T2: Implement Variable Injection System
**Token Budget**: 6,000 tokens
**LOC Budget**: 400 lines

```typescript
// src/ai/prompts/injector.ts
class PromptInjector {
  inject(template: PromptTemplate, context: CrashContext): string {
    // Validate all required variables present
    // Sanitize inputs to prevent injection
    // Apply template with proper escaping
    // Return compiled prompt
  }

  private validateContext(template: PromptTemplate, context: any): void {
    // Type checking and validation
  }
}
```

#### A-1-T3: Build Smalltalk-Specific System Prompts
**Token Budget**: 10,000 tokens
**LOC Budget**: 300 lines

```typescript
// src/ai/prompts/smalltalk-prompts.ts
export const SMALLTALK_SYSTEM_PROMPT = `
You are an expert Smalltalk developer analyzing crash logs.
Focus on:
1. Message not understood errors (MNU)
2. Stack overflow in recursive methods
3. Collection bounds violations
4. Type mismatches in primitives
5. Memory issues with large objects

Output structured JSON:
{
  "rootCause": "specific technical explanation",
  "category": "MNU|STACK|BOUNDS|TYPE|MEMORY|OTHER",
  "fixes": [
    {
      "description": "actionable fix",
      "code": "example code snippet",
      "confidence": 0.0-1.0
    }
  ],
  "relatedClasses": ["Class names involved"],
  "preventionTips": ["Future prevention strategies"]
}
`;
```

---

## Story A-2: Few-Shot Learning Implementation
**Priority**: P0
**Dependencies**: A-1
**Status**: READY
**Unblocks**: A-3

### Acceptance Criteria
- 3-5 curated examples per crash category
- Dynamic example selection based on crash type
- Examples stored with performance metrics

### Tasks

#### A-2-T1: Create Example Corpus Database
**Token Budget**: 5,000 tokens
**LOC Budget**: 200 lines

```sql
-- migrations/add_prompt_examples.sql
CREATE TABLE prompt_examples (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    crash_fingerprint TEXT,

    -- Example content
    input_crash TEXT NOT NULL,
    ideal_output TEXT NOT NULL,

    -- Performance tracking
    usage_count INTEGER DEFAULT 0,
    success_rate REAL DEFAULT 0.0,

    -- Metadata
    created_at INTEGER NOT NULL,
    validated_by TEXT,
    is_active BOOLEAN DEFAULT 1,

    CHECK (success_rate >= 0.0 AND success_rate <= 1.0)
);

CREATE INDEX idx_examples_category ON prompt_examples(category, is_active);
CREATE INDEX idx_examples_performance ON prompt_examples(success_rate DESC);
```

#### A-2-T2: Implement Dynamic Example Selection
**Token Budget**: 8,000 tokens
**LOC Budget**: 400 lines

```typescript
// src/ai/prompts/example-selector.ts
class ExampleSelector {
  async selectExamples(crash: CrashLog, maxExamples: number = 3): Promise<FewShotExample[]> {
    // 1. Categorize crash type
    // 2. Query top-performing examples for category
    // 3. Include diverse error patterns
    // 4. Return formatted examples
  }

  private calculateSimilarity(crash1: CrashLog, crash2: CrashLog): number {
    // Jaccard similarity on stack frames
    // Edit distance on error messages
    // Weighted combination
  }
}
```

---

## Story A-3: Prompt Version Control & A/B Testing
**Priority**: P1
**Dependencies**: A-2
**Status**: READY
**Unblocks**: G-1

### Acceptance Criteria
- Semantic versioning for all prompts
- A/B test framework with statistical significance
- Automatic promotion of winning variants

### Tasks

#### A-3-T1: Implement Version Control System
**Token Budget**: 7,000 tokens
**LOC Budget**: 350 lines

```typescript
// src/ai/prompts/versioning.ts
class PromptVersionManager {
  private readonly GIT_STYLE_HASH = true;

  async createVersion(promptId: string, changes: PromptChanges): Promise<string> {
    // Generate semantic version or hash
    // Store with diff from previous
    // Update version history
  }

  async compareVersions(v1: string, v2: string): Promise<VersionComparison> {
    // Statistical comparison of performance
    // Calculate p-value for significance
    // Return recommendation
  }
}
```

#### A-3-T2: Build A/B Testing Framework
**Token Budget**: 10,000 tokens
**LOC Budget**: 500 lines

```typescript
// src/ai/experiments/ab-testing.ts
class ABTestRunner {
  private readonly MIN_SAMPLE_SIZE = 100;
  private readonly SIGNIFICANCE_LEVEL = 0.05;

  async assignVariant(userId: string, experimentId: string): Promise<string> {
    // Deterministic assignment based on hash
    // Ensure even distribution
    // Track assignment in database
  }

  async evaluateExperiment(experimentId: string): Promise<ExperimentResults> {
    // Calculate conversion rates
    // Run statistical significance test
    // Generate recommendation
  }
}
```

---

# EPIC B: Response Caching System
**Objective**: Reduce costs by 40% through intelligent caching
**DoD**:
- Cache hit rate >40% measured over 7 days
- P95 cache lookup <10ms
- Zero cache poisoning incidents

## Story B-1: Cache Infrastructure
**Priority**: P0 - Critical Path
**Dependencies**: A-1
**Status**: READY
**Unblocks**: B-2, B-3

### Acceptance Criteria
- SQLite cache with indexed lookups
- TTL-based expiration with background cleanup
- Atomic operations for cache updates

### Tasks

#### B-1-T1: Create Cache Database Schema
**Token Budget**: 4,000 tokens
**LOC Budget**: 150 lines

```sql
-- migrations/create_analysis_cache.sql
CREATE TABLE IF NOT EXISTS analysis_cache (
    fingerprint TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,

    -- Crash identification
    crash_hash TEXT NOT NULL,
    error_type TEXT NOT NULL,
    stack_trace_hash TEXT NOT NULL,

    -- Cached response
    analysis_json TEXT NOT NULL,
    analysis_version INTEGER DEFAULT 1,

    -- Cache metadata
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT,
    cache_hits INTEGER DEFAULT 0,
    last_hit_at INTEGER,

    -- Validation
    is_valid BOOLEAN DEFAULT 1,
    validation_score REAL,

    CHECK (expires_at > created_at),
    CHECK (cache_hits >= 0)
);

-- Performance indexes
CREATE INDEX idx_cache_fingerprint ON analysis_cache(fingerprint);
CREATE INDEX idx_cache_expiry ON analysis_cache(expires_at) WHERE is_valid = 1;
CREATE INDEX idx_cache_lookup ON analysis_cache(crash_hash, error_type) WHERE is_valid = 1;

-- Cache statistics table
CREATE TABLE cache_metrics (
    date TEXT PRIMARY KEY,
    total_requests INTEGER DEFAULT 0,
    cache_hits INTEGER DEFAULT 0,
    cache_misses INTEGER DEFAULT 0,
    avg_lookup_ms REAL,
    space_used_mb REAL
);
```

#### B-1-T2: Implement Cache Manager
**Token Budget**: 12,000 tokens
**LOC Budget**: 600 lines

```typescript
// src/ai/cache/cache-manager.ts
interface CacheEntry {
  fingerprint: string;
  analysis: AnalysisResult;
  metadata: CacheMetadata;
}

class AnalysisCacheManager {
  private readonly DEFAULT_TTL = 30 * 24 * 60 * 60; // 30 days
  private readonly MAX_CACHE_SIZE_MB = 500;

  async get(crashFingerprint: string): Promise<CacheEntry | null> {
    // Check expiration
    // Increment hit counter
    // Return analysis or null
  }

  async set(crash: CrashLog, analysis: AnalysisResult, metadata: CacheMetadata): Promise<void> {
    // Generate fingerprint
    // Check cache size limits
    // Store with TTL
    // Trigger async cleanup if needed
  }

  private async evictLRU(): Promise<void> {
    // Remove least recently used entries
    // Maintain size constraints
  }
}
```

---

## Story B-2: Crash Fingerprinting Algorithm
**Priority**: P0
**Dependencies**: B-1
**Status**: READY
**Unblocks**: B-3

### Acceptance Criteria
- Deterministic fingerprints for identical crashes
- Fuzzy matching for similar crashes (>90% similarity)
- Collision rate <0.01%

### Tasks

#### B-2-T1: Implement Fingerprint Generator
**Token Budget**: 8,000 tokens
**LOC Budget**: 400 lines

```typescript
// src/ai/cache/fingerprinting.ts
class CrashFingerprinter {
  private readonly SIMILARITY_THRESHOLD = 0.9;

  generateFingerprint(crash: CrashLog): string {
    // 1. Normalize error message (remove timestamps, IDs)
    // 2. Extract top N stack frames
    // 3. Hash with SHA-256
    // 4. Return base64 fingerprint
  }

  calculateSimilarity(fp1: string, fp2: string): number {
    // Implement Levenshtein distance
    // Normalize to 0-1 range
    // Return similarity score
  }

  findSimilarCached(crash: CrashLog, threshold: number = 0.9): Promise<CacheEntry[]> {
    // Generate fingerprint
    // Query similar entries
    // Filter by threshold
    // Return ranked results
  }
}
```

#### B-2-T2: Build Similarity Index
**Token Budget**: 6,000 tokens
**LOC Budget**: 300 lines

```typescript
// src/ai/cache/similarity-index.ts
class SimilarityIndex {
  private readonly index: Map<string, Set<string>>;

  async buildIndex(): Promise<void> {
    // Load all fingerprints
    // Build inverted index
    // Calculate similarity matrix
  }

  async querySimilar(fingerprint: string, k: number = 5): Promise<string[]> {
    // Use index for fast lookup
    // Return top-k similar
  }
}
```

---

## Story B-3: Cache Invalidation & Validation
**Priority**: P1
**Dependencies**: B-2
**Status**: READY

### Acceptance Criteria
- Automatic invalidation of low-quality cached responses
- Manual invalidation API for corrections
- Validation scoring based on user feedback

### Tasks

#### B-3-T1: Implement Cache Validation
**Token Budget**: 7,000 tokens
**LOC Budget**: 350 lines

```typescript
// src/ai/cache/validation.ts
class CacheValidator {
  async validateEntry(entry: CacheEntry): Promise<ValidationResult> {
    // Check structural validity
    // Verify JSON schema
    // Score based on feedback
    // Return validation result
  }

  async invalidateEntry(fingerprint: string, reason: string): Promise<void> {
    // Mark as invalid
    // Log invalidation reason
    // Trigger re-analysis if needed
  }

  async scheduleRevalidation(): Promise<void> {
    // Periodic validation job
    // Check old entries
    // Update validation scores
  }
}
```

---

# EPIC C: Smart Model Selection
**Objective**: Reduce costs by 60% through intelligent model routing
**DoD**:
- Cost reduction >60% with maintained accuracy
- Model selection latency <50ms
- Automatic failover operational

## Story C-1: Complexity Detection Engine
**Priority**: P0
**Dependencies**: A-1
**Status**: READY
**Unblocks**: C-2

### Acceptance Criteria
- Classify crashes as Simple/Medium/Complex
- Accuracy >90% on classification
- Decision time <20ms

### Tasks

#### C-1-T1: Build Complexity Analyzer
**Token Budget**: 10,000 tokens
**LOC Budget**: 500 lines

```typescript
// src/ai/routing/complexity-analyzer.ts
enum CrashComplexity {
  SIMPLE = 'simple',    // GPT-3.5 or Llama3
  MEDIUM = 'medium',    // GPT-4-turbo or Claude Sonnet
  COMPLEX = 'complex'   // GPT-4 or Claude Opus
}

class ComplexityAnalyzer {
  private readonly SIMPLE_PATTERNS = [
    /NullPointerException/,
    /ArrayIndexOutOfBounds/,
    /MessageNotUnderstood.*selector:/
  ];

  analyze(crash: CrashLog): ComplexityScore {
    const factors = {
      stackDepth: this.scoreStackDepth(crash),
      errorComplexity: this.scoreErrorMessage(crash),
      codeInvolved: this.scoreCodeComplexity(crash),
      historicalDifficulty: this.scoreHistoricalDifficulty(crash)
    };

    return this.calculateWeightedScore(factors);
  }

  private scoreStackDepth(crash: CrashLog): number {
    // <10 frames = 0.2, 10-30 = 0.5, >30 = 0.8
  }

  private scoreErrorMessage(crash: CrashLog): number {
    // Simple patterns = 0.2, Unknown = 0.8
  }
}
```

#### C-1-T2: Create Classification Rules Engine
**Token Budget**: 6,000 tokens
**LOC Budget**: 300 lines

```typescript
// src/ai/routing/classification-rules.ts
interface ClassificationRule {
  id: string;
  condition: (crash: CrashLog) => boolean;
  complexity: CrashComplexity;
  confidence: number;
}

class RulesEngine {
  private rules: ClassificationRule[] = [
    {
      id: 'simple-npe',
      condition: (crash) => crash.error.includes('UndefinedObject'),
      complexity: CrashComplexity.SIMPLE,
      confidence: 0.95
    },
    // More rules...
  ];

  classify(crash: CrashLog): ClassificationResult {
    // Apply rules in priority order
    // Return first matching rule
    // Default to MEDIUM if no match
  }
}
```

---

## Story C-2: Model Router Implementation
**Priority**: P0
**Dependencies**: C-1
**Status**: READY
**Unblocks**: C-3

### Acceptance Criteria
- Route to appropriate model based on complexity
- Support manual override
- Track routing decisions for analysis

### Tasks

#### C-2-T1: Build Model Router
**Token Budget**: 9,000 tokens
**LOC Budget**: 450 lines

```typescript
// src/ai/routing/model-router.ts
interface ModelRoute {
  complexity: CrashComplexity;
  provider: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

class ModelRouter {
  private routes: Map<CrashComplexity, ModelRoute[]> = new Map([
    [CrashComplexity.SIMPLE, [
      { provider: 'openai', model: 'gpt-3.5-turbo', maxTokens: 1000, temperature: 0.3 },
      { provider: 'ollama', model: 'llama3', maxTokens: 2000, temperature: 0.3 }
    ]],
    [CrashComplexity.COMPLEX, [
      { provider: 'openai', model: 'gpt-4-turbo-preview', maxTokens: 4000, temperature: 0.5 },
      { provider: 'anthropic', model: 'claude-3-opus', maxTokens: 4000, temperature: 0.5 }
    ]]
  ]);

  async route(crash: CrashLog, preferences?: UserPreferences): Promise<ModelRoute> {
    // Analyze complexity
    // Check user preferences
    // Select optimal model
    // Return route decision
  }
}
```

#### C-2-T2: Implement Cost Estimator
**Token Budget**: 5,000 tokens
**LOC Budget**: 250 lines

```typescript
// src/ai/routing/cost-estimator.ts
class CostEstimator {
  private readonly PRICING = {
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
    'gpt-4-turbo-preview': { input: 0.01, output: 0.03 },
    'claude-3-sonnet': { input: 0.003, output: 0.015 },
    'ollama': { input: 0, output: 0 }
  };

  estimate(prompt: string, model: string): CostEstimate {
    // Count tokens
    // Apply pricing
    // Add margin for output
    // Return estimate
  }
}
```

---

## Story C-3: Automatic Failover System
**Priority**: P1
**Dependencies**: C-2
**Status**: READY

### Acceptance Criteria
- Failover within 2 seconds of primary failure
- Maintain request context during failover
- Log all failover events

### Tasks

#### C-3-T1: Build Failover Manager
**Token Budget**: 8,000 tokens
**LOC Budget**: 400 lines

```typescript
// src/ai/routing/failover-manager.ts
class FailoverManager {
  private readonly MAX_RETRIES = 3;
  private readonly TIMEOUT_MS = 30000;

  async executeWithFailover(request: AnalysisRequest): Promise<AnalysisResult> {
    const providers = this.getProviderChain(request);

    for (const provider of providers) {
      try {
        return await this.tryProvider(provider, request);
      } catch (error) {
        this.logFailure(provider, error);
        // Continue to next provider
      }
    }

    throw new Error('All providers failed');
  }

  private async tryProvider(provider: AIProvider, request: AnalysisRequest): Promise<AnalysisResult> {
    // Set timeout
    // Execute request
    // Validate response
    // Return result
  }
}
```

---

# EPIC D: Multi-Provider Support
**Objective**: Support OpenAI, Anthropic, Google, and Ollama
**DoD**:
- All 4 providers integrated and tested
- Provider comparison dashboard operational
- Zero provider-specific code in business logic

## Story D-1: Provider Abstraction Layer
**Priority**: P0 - Critical Path
**Status**: READY
**Unblocks**: D-2, D-3, D-4

### Acceptance Criteria
- Uniform interface for all providers
- Provider-specific adapters
- Configuration hot-reload

### Tasks

#### D-1-T1: Define Provider Interface
**Token Budget**: 6,000 tokens
**LOC Budget**: 300 lines

```typescript
// src/ai/providers/base-provider.ts
interface AIProvider {
  name: string;

  // Core methods
  analyze(prompt: string, options: AnalysisOptions): Promise<AIResponse>;
  stream(prompt: string, options: StreamOptions): AsyncIterable<string>;

  // Cost & limits
  estimateCost(tokens: TokenCount): number;
  getTokenLimit(): number;

  // Health & status
  healthCheck(): Promise<HealthStatus>;
  getModels(): Promise<ModelInfo[]>;

  // Features
  supportsStreaming(): boolean;
  supportsFunctionCalling(): boolean;
  supportsVision(): boolean;
}

interface AIResponse {
  content: string;
  model: string;
  provider: string;
  tokens: TokenCount;
  latency: number;
  cached: boolean;
  metadata?: Record<string, any>;
}
```

#### D-1-T2: Implement Base Provider Class
**Token Budget**: 8,000 tokens
**LOC Budget**: 400 lines

```typescript
// src/ai/providers/base-provider.impl.ts
abstract class BaseAIProvider implements AIProvider {
  protected config: ProviderConfig;
  protected rateLimiter: RateLimiter;
  protected metrics: MetricsCollector;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter(config.rateLimit);
    this.metrics = new MetricsCollector(config.name);
  }

  async analyze(prompt: string, options: AnalysisOptions): Promise<AIResponse> {
    // Rate limiting
    await this.rateLimiter.acquire();

    // Metrics start
    const startTime = Date.now();

    try {
      // Provider-specific implementation
      const response = await this.doAnalyze(prompt, options);

      // Metrics collection
      this.metrics.record({
        provider: this.name,
        latency: Date.now() - startTime,
        tokens: response.tokens,
        success: true
      });

      return response;
    } catch (error) {
      this.metrics.recordError(error);
      throw error;
    }
  }

  protected abstract doAnalyze(prompt: string, options: AnalysisOptions): Promise<AIResponse>;
}
```

---

## Story D-2: OpenAI Provider Enhancement
**Priority**: P0
**Dependencies**: D-1
**Status**: READY
**Unblocks**: E-1

### Acceptance Criteria
- Support GPT-3.5 and GPT-4 models
- Streaming with Server-Sent Events
- Function calling support

### Tasks

#### D-2-T1: Enhance OpenAI Provider
**Token Budget**: 10,000 tokens
**LOC Budget**: 500 lines

```typescript
// src/ai/providers/openai-provider.ts
import { OpenAI } from 'openai';

class OpenAIProvider extends BaseAIProvider {
  private client: OpenAI;

  constructor(config: OpenAIConfig) {
    super(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3
    });
  }

  protected async doAnalyze(prompt: string, options: AnalysisOptions): Promise<AIResponse> {
    const completion = await this.client.chat.completions.create({
      model: options.model || 'gpt-4-turbo-preview',
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: options.temperature || 0.3,
      max_tokens: options.maxTokens || 2000,
      response_format: { type: 'json_object' }
    });

    return {
      content: completion.choices[0].message.content,
      model: completion.model,
      provider: 'openai',
      tokens: {
        input: completion.usage.prompt_tokens,
        output: completion.usage.completion_tokens,
        total: completion.usage.total_tokens
      },
      latency: 0, // Set by base class
      cached: false
    };
  }

  async *stream(prompt: string, options: StreamOptions): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: options.model,
      messages: [{ role: 'user', content: prompt }],
      stream: true
    });

    for await (const chunk of stream) {
      yield chunk.choices[0]?.delta?.content || '';
    }
  }
}
```

---

## Story D-3: Anthropic Claude Provider
**Priority**: P0
**Dependencies**: D-1
**Status**: READY
**Unblocks**: E-1

### Acceptance Criteria
- Support Claude 3 models (Haiku, Sonnet, Opus)
- Message-based API compatibility
- Cost tracking per model

### Tasks

#### D-3-T1: Implement Claude Provider
**Token Budget**: 10,000 tokens
**LOC Budget**: 500 lines

```typescript
// src/ai/providers/anthropic-provider.ts
import Anthropic from '@anthropic-ai/sdk';

class AnthropicProvider extends BaseAIProvider {
  private client: Anthropic;

  constructor(config: AnthropicConfig) {
    super(config);
    this.client = new Anthropic({
      apiKey: config.apiKey
    });
  }

  protected async doAnalyze(prompt: string, options: AnalysisOptions): Promise<AIResponse> {
    const message = await this.client.messages.create({
      model: options.model || 'claude-3-sonnet-20240229',
      max_tokens: options.maxTokens || 2000,
      temperature: options.temperature || 0.3,
      system: options.systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    });

    return {
      content: message.content[0].text,
      model: message.model,
      provider: 'anthropic',
      tokens: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        total: message.usage.input_tokens + message.usage.output_tokens
      },
      latency: 0,
      cached: false
    };
  }
}
```

---

## Story D-4: Ollama Local AI Provider
**Priority**: P1
**Dependencies**: D-1
**Status**: READY

### Acceptance Criteria
- Connect to local Ollama instance
- Support multiple local models
- Zero-cost operation verification

### Tasks

#### D-4-T1: Implement Ollama Provider
**Token Budget**: 10,000 tokens
**LOC Budget**: 500 lines

```typescript
// src/ai/providers/ollama-provider.ts
class OllamaProvider extends BaseAIProvider {
  private endpoint: string;

  constructor(config: OllamaConfig) {
    super(config);
    this.endpoint = config.endpoint || 'http://localhost:11434';
  }

  protected async doAnalyze(prompt: string, options: AnalysisOptions): Promise<AIResponse> {
    const response = await fetch(`${this.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model || 'llama3',
        prompt: this.formatPrompt(options.systemPrompt, prompt),
        stream: false,
        format: 'json',
        options: {
          temperature: options.temperature || 0.3,
          num_predict: options.maxTokens || 2000
        }
      })
    });

    const result = await response.json();

    return {
      content: result.response,
      model: result.model,
      provider: 'ollama',
      tokens: {
        input: result.prompt_eval_count || 0,
        output: result.eval_count || 0,
        total: (result.prompt_eval_count || 0) + (result.eval_count || 0)
      },
      latency: result.total_duration / 1000000, // Convert nanoseconds to ms
      cached: false
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`);
      const data = await response.json();
      return {
        healthy: true,
        models: data.models.map(m => m.name),
        latency: 0
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }
}
```

#### D-4-T2: Create Ollama Connection Manager
**Token Budget**: 6,000 tokens
**LOC Budget**: 300 lines

```typescript
// src/ai/providers/ollama-connection.ts
class OllamaConnectionManager {
  private isConnected: boolean = false;
  private availableModels: string[] = [];

  async connect(endpoint: string): Promise<void> {
    // Test connection
    // List available models
    // Verify model compatibility
  }

  async ensureModelLoaded(model: string): Promise<void> {
    // Check if model is loaded
    // Pull model if needed
    // Wait for model ready
  }
}
```

---

# EPIC E: Streaming & Real-time Display
**Objective**: Stream AI responses with <100ms to first token
**DoD**:
- First token latency p95 <100ms
- Smooth UI updates without flicker
- Abort capability with cleanup

## Story E-1: Streaming Infrastructure
**Priority**: P0
**Dependencies**: D-2, D-3
**Status**: READY
**Unblocks**: E-2

### Acceptance Criteria
- Server-Sent Events (SSE) implementation
- Backpressure handling
- Connection recovery

### Tasks

#### E-1-T1: Implement Stream Manager
**Token Budget**: 10,000 tokens
**LOC Budget**: 500 lines

```typescript
// src/ai/streaming/stream-manager.ts
class StreamManager {
  private activeStreams: Map<string, AbortController> = new Map();

  async *streamAnalysis(
    provider: AIProvider,
    prompt: string,
    options: StreamOptions
  ): AsyncGenerator<StreamChunk> {
    const streamId = this.generateStreamId();
    const abortController = new AbortController();
    this.activeStreams.set(streamId, abortController);

    try {
      const stream = provider.stream(prompt, {
        ...options,
        signal: abortController.signal
      });

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;

        yield {
          id: streamId,
          type: 'content',
          data: chunk,
          timestamp: Date.now()
        };
      }

      yield {
        id: streamId,
        type: 'complete',
        timestamp: Date.now()
      };
    } catch (error) {
      yield {
        id: streamId,
        type: 'error',
        error: error.message,
        timestamp: Date.now()
      };
    } finally {
      this.activeStreams.delete(streamId);
    }
  }

  abort(streamId: string): void {
    this.activeStreams.get(streamId)?.abort();
  }
}
```

#### E-1-T2: Build SSE Transport Layer
**Token Budget**: 8,000 tokens
**LOC Budget**: 400 lines

```typescript
// src/ai/streaming/sse-transport.ts
class SSETransport {
  private eventSource: EventSource;
  private reconnectAttempts: number = 0;

  connect(url: string, handlers: EventHandlers): void {
    this.eventSource = new EventSource(url);

    this.eventSource.onmessage = (event) => {
      const chunk = JSON.parse(event.data);
      handlers.onChunk(chunk);
    };

    this.eventSource.onerror = (error) => {
      if (this.reconnectAttempts < 3) {
        this.reconnect(url, handlers);
      } else {
        handlers.onError(error);
      }
    };
  }

  private reconnect(url: string, handlers: EventHandlers): void {
    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect(url, handlers);
    }, Math.pow(2, this.reconnectAttempts) * 1000);
  }
}
```

---

## Story E-2: UI Streaming Components
**Priority**: P1
**Dependencies**: E-1
**Status**: READY

### Acceptance Criteria
- Progressive text rendering
- Markdown formatting preserved
- Smooth scrolling during stream

### Tasks

#### E-2-T1: Create Streaming Display Component
**Token Budget**: 8,000 tokens
**LOC Budget**: 400 lines

```typescript
// src/ui/components/StreamingAnalysis.tsx
import React, { useState, useEffect, useRef } from 'react';

interface StreamingAnalysisProps {
  streamId: string;
  onComplete: (analysis: AnalysisResult) => void;
}

export const StreamingAnalysis: React.FC<StreamingAnalysisProps> = ({ streamId, onComplete }) => {
  const [content, setContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const eventSource = new EventSource(`/api/stream/${streamId}`);

    eventSource.onmessage = (event) => {
      const chunk = JSON.parse(event.data);

      if (chunk.type === 'content') {
        setContent(prev => prev + chunk.data);
        // Auto-scroll to bottom
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      } else if (chunk.type === 'complete') {
        setIsStreaming(false);
        eventSource.close();
        onComplete(JSON.parse(content));
      }
    };

    return () => eventSource.close();
  }, [streamId]);

  return (
    <div ref={containerRef} className="streaming-container">
      <div className="analysis-content">
        {content}
        {isStreaming && <span className="cursor-blink">▊</span>}
      </div>
      {isStreaming && (
        <button onClick={() => abortStream(streamId)}>
          Stop Analysis
        </button>
      )}
    </div>
  );
};
```

---

# EPIC F: Cost Tracking & Budget Management
**Objective**: Complete cost visibility and budget enforcement
**DoD**:
- Cost tracking accuracy >99%
- Budget alerts trigger at 80% usage
- Cost dashboard operational

## Story F-1: Token Counting & Cost Calculation
**Priority**: P0
**Dependencies**: E-1
**Status**: READY
**Unblocks**: F-2

### Acceptance Criteria
- Accurate token counting per provider
- Real-time cost calculation
- Historical cost aggregation

### Tasks

#### F-1-T1: Implement Token Counter
**Token Budget**: 7,000 tokens
**LOC Budget**: 350 lines

```typescript
// src/ai/billing/token-counter.ts
class TokenCounter {
  private encoders: Map<string, any> = new Map();

  constructor() {
    // Initialize tokenizers for each provider
    this.encoders.set('openai', new GPTTokenizer());
    this.encoders.set('anthropic', new ClaudeTokenizer());
  }

  count(text: string, provider: string): number {
    const encoder = this.encoders.get(provider);
    if (!encoder) {
      // Fallback to approximate count
      return Math.ceil(text.length / 4);
    }
    return encoder.encode(text).length;
  }

  estimateOutputTokens(prompt: string, provider: string): number {
    // Based on historical data
    const inputTokens = this.count(prompt, provider);
    return Math.ceil(inputTokens * 0.8); // 80% of input as estimate
  }
}
```

#### F-1-T2: Create Cost Calculator
**Token Budget**: 8,000 tokens
**LOC Budget**: 400 lines

```typescript
// src/ai/billing/cost-calculator.ts
class CostCalculator {
  private readonly PRICING = {
    openai: {
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-4-turbo-preview': { input: 0.01, output: 0.03 }
    },
    anthropic: {
      'claude-3-haiku': { input: 0.00025, output: 0.00125 },
      'claude-3-sonnet': { input: 0.003, output: 0.015 },
      'claude-3-opus': { input: 0.015, output: 0.075 }
    },
    ollama: {
      '*': { input: 0, output: 0 } // Free!
    }
  };

  calculate(tokens: TokenCount, provider: string, model: string): number {
    const pricing = this.PRICING[provider]?.[model];
    if (!pricing) return 0;

    const inputCost = (tokens.input / 1000) * pricing.input;
    const outputCost = (tokens.output / 1000) * pricing.output;

    return inputCost + outputCost;
  }
}
```

---

## Story F-2: Budget Management System
**Priority**: P1
**Dependencies**: F-1
**Status**: READY
**Unblocks**: F-3

### Acceptance Criteria
- Monthly budget limits enforced
- Alert at 80% threshold
- Hard stop at 100% unless overridden

### Tasks

#### F-2-T1: Implement Budget Manager
**Token Budget**: 10,000 tokens
**LOC Budget**: 500 lines

```typescript
// src/ai/billing/budget-manager.ts
class BudgetManager {
  private currentSpend: number = 0;
  private monthlyLimit: number;
  private alertThreshold: number = 0.8;

  async checkBudget(estimatedCost: number): Promise<BudgetStatus> {
    const projected = this.currentSpend + estimatedCost;

    if (projected > this.monthlyLimit) {
      return {
        allowed: false,
        reason: 'Monthly budget exceeded',
        currentSpend: this.currentSpend,
        limit: this.monthlyLimit,
        remaining: Math.max(0, this.monthlyLimit - this.currentSpend)
      };
    }

    if (projected > this.monthlyLimit * this.alertThreshold) {
      this.sendBudgetAlert(projected);
    }

    return {
      allowed: true,
      currentSpend: this.currentSpend,
      limit: this.monthlyLimit,
      remaining: this.monthlyLimit - this.currentSpend
    };
  }

  private async sendBudgetAlert(projected: number): Promise<void> {
    // Send notification to UI
    // Log to metrics
    // Optional: Send email
  }
}
```

#### F-2-T2: Create Budget Database Schema
**Token Budget**: 4,000 tokens
**LOC Budget**: 150 lines

```sql
-- migrations/create_budget_tables.sql
CREATE TABLE budget_config (
    id INTEGER PRIMARY KEY,
    monthly_limit REAL NOT NULL,
    alert_threshold REAL DEFAULT 0.8,
    hard_stop BOOLEAN DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    CHECK (monthly_limit > 0),
    CHECK (alert_threshold BETWEEN 0.1 AND 1.0)
);

CREATE TABLE spending_log (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    cost REAL NOT NULL,
    tokens_input INTEGER,
    tokens_output INTEGER,
    crash_id TEXT,

    CHECK (cost >= 0)
);

CREATE INDEX idx_spending_timestamp ON spending_log(timestamp);
CREATE INDEX idx_spending_month ON spending_log(strftime('%Y-%m', datetime(timestamp, 'unixepoch')));
```

---

## Story F-3: Cost Analytics Dashboard
**Priority**: P2
**Dependencies**: F-2
**Status**: READY

### Acceptance Criteria
- Daily/weekly/monthly cost views
- Provider breakdown
- Savings from cache visualization

### Tasks

#### F-3-T1: Build Cost Dashboard Component
**Token Budget**: 10,000 tokens
**LOC Budget**: 500 lines

```typescript
// src/ui/components/CostDashboard.tsx
import React from 'react';
import { LineChart, PieChart } from 'recharts';

export const CostDashboard: React.FC = () => {
  const { data, loading } = useCostData();

  return (
    <div className="cost-dashboard">
      <div className="summary-cards">
        <Card title="This Month" value={`$${data.monthlyTotal.toFixed(2)}`} />
        <Card title="Average per Analysis" value={`$${data.avgCost.toFixed(3)}`} />
        <Card title="Cache Savings" value={`$${data.cacheSavings.toFixed(2)}`} />
        <Card title="Budget Used" value={`${data.budgetUsed}%`} />
      </div>

      <div className="charts">
        <LineChart
          data={data.dailyCosts}
          title="Daily Costs"
          xKey="date"
          yKey="cost"
        />

        <PieChart
          data={data.providerBreakdown}
          title="Cost by Provider"
        />

        <BarChart
          data={data.modelCosts}
          title="Cost by Model"
        />
      </div>

      <div className="cost-table">
        <h3>Recent Analyses</h3>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Provider</th>
              <th>Model</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>Cached</th>
            </tr>
          </thead>
          <tbody>
            {data.recentAnalyses.map(item => (
              <tr key={item.id}>
                <td>{formatTime(item.timestamp)}</td>
                <td>{item.provider}</td>
                <td>{item.model}</td>
                <td>{item.tokens}</td>
                <td>${item.cost.toFixed(4)}</td>
                <td>{item.cached ? '✓' : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
```

---

# EPIC G: Feedback Loop & Analytics
**Objective**: Learn from user feedback to improve accuracy
**DoD**:
- Feedback capture rate >30% of analyses
- Prompt improvement pipeline operational
- Analytics dashboard showing trends

## Story G-1: Feedback Collection System
**Priority**: P1
**Dependencies**: A-3
**Status**: READY
**Unblocks**: G-2

### Acceptance Criteria
- Thumbs up/down on every analysis
- Optional detailed feedback
- Correction submission capability

### Tasks

#### G-1-T1: Create Feedback Database Schema
**Token Budget**: 4,000 tokens
**LOC Budget**: 150 lines

```sql
-- migrations/create_feedback_tables.sql
CREATE TABLE analysis_feedback (
    id TEXT PRIMARY KEY,
    crash_id TEXT NOT NULL,
    analysis_id TEXT NOT NULL,

    -- Feedback data
    rating INTEGER CHECK (rating IN (-1, 0, 1)), -- -1: bad, 0: neutral, 1: good
    feedback_type TEXT,
    feedback_text TEXT,

    -- Corrections
    corrected_root_cause TEXT,
    corrected_fixes TEXT,

    -- Metadata
    prompt_version TEXT,
    model_used TEXT,
    created_at INTEGER NOT NULL,

    FOREIGN KEY (crash_id) REFERENCES crashes(id),
    FOREIGN KEY (analysis_id) REFERENCES analyses(id)
);

CREATE INDEX idx_feedback_rating ON analysis_feedback(rating);
CREATE INDEX idx_feedback_prompt ON analysis_feedback(prompt_version);
```

#### G-1-T2: Implement Feedback UI Component
**Token Budget**: 8,000 tokens
**LOC Budget**: 400 lines

```typescript
// src/ui/components/FeedbackWidget.tsx
import React, { useState } from 'react';

interface FeedbackWidgetProps {
  analysisId: string;
  onSubmit: (feedback: Feedback) => void;
}

export const FeedbackWidget: React.FC<FeedbackWidgetProps> = ({ analysisId, onSubmit }) => {
  const [rating, setRating] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [feedback, setFeedback] = useState({
    type: '',
    text: '',
    corrections: {}
  });

  const handleRating = (value: number) => {
    setRating(value);
    if (value === -1) {
      setShowDetails(true);
    } else {
      submitFeedback({ rating: value });
    }
  };

  return (
    <div className="feedback-widget">
      <div className="rating-buttons">
        <button
          className={rating === 1 ? 'active' : ''}
          onClick={() => handleRating(1)}
        >
          👍 Helpful
        </button>
        <button
          className={rating === -1 ? 'active' : ''}
          onClick={() => handleRating(-1)}
        >
          👎 Not Helpful
        </button>
      </div>

      {showDetails && (
        <div className="feedback-details">
          <h4>What was wrong?</h4>
          <label>
            <input
              type="checkbox"
              value="incorrect-root-cause"
              onChange={(e) => updateFeedbackType(e.target.value)}
            />
            Root cause incorrect
          </label>
          <label>
            <input
              type="checkbox"
              value="generic-fixes"
              onChange={(e) => updateFeedbackType(e.target.value)}
            />
            Fixes too generic
          </label>
          <label>
            <input
              type="checkbox"
              value="missed-problem"
              onChange={(e) => updateFeedbackType(e.target.value)}
            />
            Missed the actual problem
          </label>

          <textarea
            placeholder="Additional feedback (optional)"
            value={feedback.text}
            onChange={(e) => setFeedback({...feedback, text: e.target.value})}
          />

          <button onClick={() => submitDetailedFeedback()}>
            Submit Feedback
          </button>
        </div>
      )}
    </div>
  );
};
```

---

## Story G-2: Prompt Improvement Pipeline
**Priority**: P2
**Dependencies**: G-1
**Status**: READY

### Acceptance Criteria
- Analyze feedback patterns weekly
- Generate prompt improvement suggestions
- A/B test new prompts automatically

### Tasks

#### G-2-T1: Build Feedback Analyzer
**Token Budget**: 10,000 tokens
**LOC Budget**: 500 lines

```typescript
// src/ai/analytics/feedback-analyzer.ts
class FeedbackAnalyzer {
  async analyzeFeedbackPatterns(timeRange: TimeRange): Promise<FeedbackInsights> {
    // Query feedback data
    const feedback = await this.queryFeedback(timeRange);

    // Identify patterns
    const patterns = {
      commonFailures: this.findCommonFailurePatterns(feedback),
      modelPerformance: this.compareModelPerformance(feedback),
      promptVersionScores: this.scorePromptVersions(feedback),
      improvementSuggestions: this.generateSuggestions(feedback)
    };

    return patterns;
  }

  private findCommonFailurePatterns(feedback: Feedback[]): FailurePattern[] {
    // Group by failure type
    // Identify recurring issues
    // Extract common keywords
    // Return ranked patterns
  }

  private generateSuggestions(feedback: Feedback[]): PromptSuggestion[] {
    // Analyze negative feedback
    // Extract correction patterns
    // Generate prompt improvements
    // Prioritize by impact
  }
}
```

#### G-2-T2: Implement Automatic A/B Testing
**Token Budget**: 8,000 tokens
**LOC Budget**: 400 lines

```typescript
// src/ai/experiments/auto-experimenter.ts
class AutoExperimenter {
  async createExperimentFromFeedback(insights: FeedbackInsights): Promise<Experiment> {
    // Generate hypothesis
    const hypothesis = this.formulateHypothesis(insights);

    // Create variant prompts
    const control = await this.getCurrentPrompt();
    const variant = await this.generateVariant(control, insights);

    // Setup experiment
    const experiment = {
      id: generateId(),
      hypothesis,
      control,
      variant,
      targetSampleSize: 200,
      successMetric: 'positive_feedback_rate',
      startDate: Date.now()
    };

    await this.startExperiment(experiment);
    return experiment;
  }
}
```

---

## Testing Strategy

### Unit Tests (Story T-1)
**Coverage Target**: ≥80%
- Prompt template validation
- Cache fingerprinting algorithms
- Cost calculation accuracy
- Token counting precision

### Integration Tests (Story T-2)
**Coverage**: All provider integrations
- Provider failover scenarios
- Cache hit/miss flows
- Streaming data integrity
- Budget enforcement

### E2E Tests (Story T-3)
**Critical Paths**:
1. Submit crash → AI analysis → Display result
2. Budget limit → Alert → Hard stop
3. Feedback submission → Prompt improvement
4. Provider failure → Failover → Success

### Performance Tests (Story T-4)
**Thresholds**:
- Cache lookup: p95 <10ms
- First token latency: p95 <100ms
- Analysis completion: p95 <15s
- Dashboard load: p95 <500ms

### Contract Tests (Story T-5)
**Provider Contracts**:
- OpenAI API schema validation
- Anthropic message format
- Ollama response structure
- SSE event format

---

## Observability Requirements

### Metrics (Story O-1)
```typescript
// Required metrics
const GOLDEN_SIGNALS = {
  latency: {
    'ai.analysis.duration': 'histogram',
    'ai.cache.lookup.duration': 'histogram',
    'ai.stream.first_token': 'histogram'
  },
  traffic: {
    'ai.requests.total': 'counter',
    'ai.cache.hits': 'counter',
    'ai.cache.misses': 'counter'
  },
  errors: {
    'ai.errors.total': 'counter',
    'ai.provider.failures': 'counter',
    'ai.budget.exceeded': 'counter'
  },
  saturation: {
    'ai.budget.usage': 'gauge',
    'ai.cache.size': 'gauge',
    'ai.concurrent.streams': 'gauge'
  }
};
```

### SLOs
- AI Analysis – p95 latency < 15s over 5min
- Cache Service – p95 lookup < 10ms over 1min
- Streaming – First token < 100ms over 5min
- Provider Availability – >99.5% over 1hour
- Budget Alerting – Trigger within 60s of threshold

### Logging
```typescript
// Structured logging format
interface AILogEntry {
  timestamp: string;
  correlationId: string;
  crashId: string;
  provider: string;
  model: string;
  promptVersion: string;
  tokens: TokenCount;
  cost: number;
  cached: boolean;
  duration: number;
  error?: string;
}
```

---

## Architecture Decision Records

### ADR-001: SQLite for Caching
**Decision**: Use SQLite instead of Redis for cache storage
**Rationale**: Desktop app, no network dependency, simpler deployment
**Consequences**: May need migration if scaling beyond single machine

### ADR-002: Streaming via SSE
**Decision**: Server-Sent Events for streaming instead of WebSockets
**Rationale**: Simpler, unidirectional, auto-reconnect support
**Consequences**: Limited to server→client communication

### ADR-003: Ollama for Local AI
**Decision**: Support Ollama as primary local AI provider
**Rationale**: Active community, wide model support, zero cost
**Consequences**: Requires separate Ollama installation

### ADR-004: Token Counting Strategy
**Decision**: Use provider-specific tokenizers when available
**Rationale**: Accuracy critical for cost calculation
**Consequences**: Additional dependencies per provider

---

## Feature Flags

```typescript
// Required feature flags
const FEATURE_FLAGS = {
  'ai.cache.enabled': true,
  'ai.streaming.enabled': false, // Roll out gradually
  'ai.ollama.enabled': false,    // Beta feature
  'ai.budget.enforcement': true,
  'ai.feedback.collection': true,
  'ai.auto_experiments': false   // Staff only initially
};
```

---

## Rollback Strategy

1. **Prompt Rollback**: Version control allows instant revert
2. **Provider Rollback**: Feature flags disable providers
3. **Cache Rollback**: Can disable cache, fall back to direct calls
4. **Schema Rollback**: Migration down scripts for all changes

---

## Security Considerations

1. **API Key Storage**: Encrypted in local keychain
2. **Prompt Injection**: Input sanitization before AI calls
3. **Cache Poisoning**: Validation layer on cache entries
4. **Budget Bypass**: Audit log for override events
5. **Local AI**: Firewall rules for Ollama endpoint

---

## Data Governance

### PII Handling
- Crash logs sanitized before caching
- No user data in feedback without consent
- 30-day retention for cache entries
- Right to deletion supported

### Test Data
- Synthetic crash logs for testing
- Anonymized production samples
- No real user data in tests

---

## Dependencies

### External Libraries
```json
{
  "openai": "^4.0.0",
  "@anthropic-ai/sdk": "^0.9.0",
  "gpt-tokenizer": "^2.1.0",
  "recharts": "^2.10.0"
}
```

### System Requirements
- Node.js 18+
- SQLite 3.40+
- Ollama 0.1.20+ (optional)

---

# EPIC H: PII Redaction with Presidio (NEW)
**Objective**: Prevent sensitive data leakage to AI providers
**Reference**: [microsoft/presidio](https://github.com/microsoft/presidio) (2.8k stars)

## Story H-1: Integrate Presidio for PII Detection
**Priority**: P0 - CRITICAL (Security)
**Status**: READY

### Acceptance Criteria
```gherkin
Given a crash log contains sensitive data (API keys, emails, IPs, tokens)
When the log is prepared for AI analysis
Then Presidio detects and redacts all PII
And the original values are stored securely (not sent to AI)
And the redacted version is sent to AI providers
And analysis results reference redacted placeholders
```

### Tasks

#### H-1-T1: Install and Configure Presidio
**Token Budget**: 7,000
**Reference**: [Presidio Getting Started](https://microsoft.github.io/presidio/getting_started/)

```bash
# Install Presidio
pip install presidio-analyzer presidio-anonymizer

# Download spaCy model for NER
python -m spacy download en_core_web_lg
```

```typescript
// backend/services/pii-redaction.service.ts
import { PresidioAnalyzer, PresidioAnonymizer } from 'presidio-node';

export class PIIRedactionService {
    private analyzer: PresidioAnalyzer;
    private anonymizer: PresidioAnonymizer;

    constructor() {
        this.analyzer = new PresidioAnalyzer();
        this.anonymizer = new PresidioAnonymizer();
    }

    async redactPII(crashLog: string): Promise<{ redacted: string; entities: PIIEntity[] }> {
        // Analyze for PII
        const results = await this.analyzer.analyze({
            text: crashLog,
            language: 'en',
            entities: [
                'CREDIT_CARD', 'EMAIL_ADDRESS', 'PHONE_NUMBER',
                'IP_ADDRESS', 'CRYPTO', 'US_SSN', 'API_KEY'
            ]
        });

        // Anonymize with placeholders
        const anonymized = await this.anonymizer.anonymize({
            text: crashLog,
            analyzerResults: results,
            operators: {
                'DEFAULT': { type: 'replace', new_value: '<REDACTED>' },
                'EMAIL_ADDRESS': { type: 'mask', chars_to_mask: 12, from_end: false },
                'API_KEY': { type: 'replace', new_value: '<API_KEY_REDACTED>' }
            }
        });

        return {
            redacted: anonymized.text,
            entities: results.map(r => ({
                type: r.entity_type,
                start: r.start,
                end: r.end,
                score: r.score
            }))
        };
    }
}
```

---

# EPIC I: Circuit Breakers with Opossum (NEW)
**Objective**: Prevent cascading failures from AI provider outages
**Reference**: [nodeshift/opossum](https://github.com/nodeshift/opossum) (2.7k stars)

## Story I-1: Implement Circuit Breaker for AI Calls
**Priority**: P0 - CRITICAL (Reliability)
**Status**: READY

### Acceptance Criteria
```gherkin
Given an AI provider is experiencing outages (>50% errors)
When the circuit breaker detects the failure rate
Then it trips to OPEN state
And subsequent requests fail-fast without calling the provider
And after a timeout, it enters HALF_OPEN state to test recovery
And if successful, returns to CLOSED state
```

### Tasks

#### I-1-T1: Configure Opossum Circuit Breakers
**Token Budget**: 8,000
**Reference**: [Opossum Documentation](https://nodeshift.dev/opossum/)

```typescript
// backend/services/ai-provider.service.ts
import CircuitBreaker from 'opossum';
import { OpenAI } from 'openai';

export class AIProviderService {
    private openaiBreaker: CircuitBreaker;

    constructor(private openai: OpenAI) {
        // Configure circuit breaker
        this.openaiBreaker = new CircuitBreaker(this.callOpenAI.bind(this), {
            timeout: 60000, // 60s timeout
            errorThresholdPercentage: 50, // Trip if >50% errors
            resetTimeout: 30000, // Try again after 30s
            volumeThreshold: 10, // Need 10 requests before tripping
            rollingCountTimeout: 60000, // 60s rolling window
        });

        // Event handlers
        this.openaiBreaker.on('open', () => {
            console.error('Circuit breaker OPEN - OpenAI is down!');
            // Fallback to Ollama or cache
        });

        this.openaiBreaker.on('halfOpen', () => {
            console.warn('Circuit breaker HALF_OPEN - Testing OpenAI recovery...');
        });

        this.openaiBreaker.on('close', () => {
            console.info('Circuit breaker CLOSED - OpenAI recovered!');
        });

        this.openaiBreaker.fallback(async (crash) => {
            // Fallback strategy: use local Ollama
            console.warn('Using Ollama fallback due to OpenAI circuit breaker');
            return this.analyzeWithOllama(crash);
        });
    }

    async analyzeCrash(crash: string): Promise<AnalysisResult> {
        try {
            return await this.openaiBreaker.fire(crash);
        } catch (error) {
            // Circuit is open or request failed
            throw new Error('AI analysis unavailable - circuit breaker open');
        }
    }

    private async callOpenAI(crash: string): Promise<AnalysisResult> {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: 'user', content: crash }]
        });
        return response.choices[0].message.content;
    }

    private async analyzeWithOllama(crash: string): Promise<AnalysisResult> {
        // Fallback to local Ollama model
        // Implementation here
    }
}
```

---

# EPIC J: Observability with OpenTelemetry (NEW)
**Objective**: End-to-end tracing and monitoring of AI pipeline
**References**:
- [OpenTelemetry](https://opentelemetry.io/)
- [winston](https://github.com/winstonjs/winston) (22k stars)

## Story J-1: Implement Distributed Tracing
**Priority**: P1 (Operations)
**Status**: READY

### Acceptance Criteria
```gherkin
Given an AI analysis request is made
When the request flows through the system
Then OpenTelemetry traces capture each step:
  - PII redaction duration
  - Cache lookup time
  - AI provider call latency
  - Circuit breaker state
  - Total end-to-end time
And logs are structured with trace IDs for correlation
And metrics are exported to Prometheus/Grafana
```

### Tasks

#### J-1-T1: Configure OpenTelemetry + Winston
**Token Budget**: 9,000
**Reference**: [OpenTelemetry Node.js](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)

```typescript
// backend/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import winston from 'winston';

// Initialize OpenTelemetry
const sdk = new NodeSDK({
    serviceName: 'crash-analyzer-ai',
    instrumentations: [getNodeAutoInstrumentations()],
    metricReader: new PrometheusExporter({ port: 9464 })
});

sdk.start();

// Structured logging with winston
export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    defaultMeta: { service: 'crash-analyzer-ai' },
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

// AI Analysis with tracing
import { trace, context } from '@opentelemetry/api';

export async function analyzeWithTracing(crash: string) {
    const tracer = trace.getTracer('ai-analysis');

    return tracer.startActiveSpan('analyze_crash', async (span) => {
        span.setAttribute('crash.size', crash.length);

        try {
            // Span for PII redaction
            const redacted = await tracer.startActiveSpan('pii_redaction', async (redactSpan) => {
                const result = await piiService.redact(crash);
                redactSpan.setAttribute('pii.entities_found', result.entities.length);
                redactSpan.end();
                return result;
            });

            // Span for AI call
            const analysis = await tracer.startActiveSpan('ai_provider_call', async (aiSpan) => {
                aiSpan.setAttribute('provider', 'openai');
                aiSpan.setAttribute('model', 'gpt-4');
                const result = await aiProvider.analyze(redacted.text);
                aiSpan.setAttribute('tokens_used', result.usage.total_tokens);
                aiSpan.end();
                return result;
            });

            span.setStatus({ code: 0 }); // Success
            logger.info('Analysis completed', {
                traceId: span.spanContext().traceId,
                duration_ms: Date.now() - span.startTime,
                pii_entities: redacted.entities.length
            });

            return analysis;
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: 2, message: error.message }); // Error
            logger.error('Analysis failed', {
                traceId: span.spanContext().traceId,
                error: error.message
            });
            throw error;
        } finally {
            span.end();
        }
    });
}
```

---

## Success Metrics

### Week 1 Targets
- Prompt accuracy: >80%
- Cache hit rate: >30%
- Cost reduction: >40%

### Week 2 Targets
- All providers integrated
- Streaming operational
- Budget enforcement live
- Feedback collection >30%

### Month 1 Targets
- Accuracy: >85%
- Cost: <$0.01 average
- Cache hit rate: >40%
- User satisfaction: >4.5/5

---

## Delivery Schedule

### Week 1
- EPIC A: Enhanced Prompt Engineering
- EPIC B: Response Caching System
- EPIC C: Smart Model Selection

### Week 2
- EPIC D: Multi-Provider Support
- EPIC E: Streaming & Real-time Display
- EPIC F: Cost Tracking & Budget Management
- EPIC G: Feedback Loop & Analytics

---

## Risk Mitigation Summary

All identified risks have mitigation strategies:
- **Prompt Regression**: Versioning + rollback
- **Cost Overruns**: Budget limits + circuit breaker
- **Provider Failures**: Multi-provider failover
- **Cache Issues**: TTL + validation
- **Performance**: Streaming + parallelization

**Final Assessment**: All systems GO for implementation ✅