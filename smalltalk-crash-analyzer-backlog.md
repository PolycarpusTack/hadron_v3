# Smalltalk Crash Analyzer - Phase 0: Week 1 MVP Backlog

## Executive Summary
**Product**: Smalltalk Crash Analyzer CLI Tool
**Timeline**: 1 week (13 hours coding)
**Tech Stack**: Python 3.10+, OpenAI/Anthropic/Ollama APIs
**Delivery Approach**: Sequential, dependency-aware execution

## Health Score Assessment
- **Clarity**: 3/3 - All requirements are unambiguous and testable
- **Feasibility**: 2/3 - Aggressive timeline requires disciplined scope management
- **Completeness**: 3/3 - All quality gates and observability included
- **Total Score**: 8/9 - **PROCEED** with careful timeline management

## Risk Ledger

| Risk ID | Description | Severity | Mitigation | Status |
|---------|------------|----------|------------|--------|
| R-001 | AI API rate limits during testing | HIGH | Implement exponential backoff + local caching | OPEN |
| R-002 | Crash log format variations | HIGH | Build flexible parser with graceful degradation | OPEN |
| R-003 | 13-hour timeline constraint | HIGH | Strict YAGNI enforcement, defer non-critical features | ACCEPTED - Owner: Alex Chen |
| R-004 | API key exposure | MEDIUM | Environment variables only, .env.example provided | OPEN |
| R-005 | Ollama local model performance | LOW | Document minimum hardware requirements | OPEN |

## Assumptions Ledger

| ID | Assumption | Impact | Validation |
|----|------------|--------|------------|
| A-001 | Crash logs follow VisualWorks standard format | HIGH | Validate with 3+ sample logs |
| A-002 | Users have Python 3.10+ installed | MEDIUM | Document in README |
| A-003 | API responses <60s acceptable | LOW | Confirm with user testing |
| A-004 | JSON output format sufficient for MVP | LOW | User feedback in Week 2 |
| A-005 | Terminal supports ANSI color codes | LOW | Provide --no-color flag |

## Architecture Decision Records (ADRs)

### ADR-001: Parser Architecture
**Decision**: Regular expression-based parser with fallback strategies
**Rationale**: Balances speed of development with flexibility
**Alternatives**: Full AST parser (overengineering for MVP)

### ADR-002: AI Provider Abstraction
**Decision**: Strategy pattern for provider switching
**Rationale**: Enables testing multiple providers without code changes
**Alternatives**: Hard-coded provider (limits validation)

### ADR-003: Configuration Management
**Decision**: YAML config + environment variables
**Rationale**: Industry standard, secure for API keys
**Alternatives**: JSON config (less readable), CLI flags only (poor UX)

### ADR-004: Error Recovery
**Decision**: Graceful degradation with partial analysis
**Rationale**: Better UX than complete failure
**Alternatives**: Fail-fast (poor developer experience)

---

## EPIC A: Core Analysis Engine
**Goal**: Build crash log parsing and analysis orchestration
**DoD**:
- ✓ Parses 3 different crash log formats successfully
- ✓ Extracts all required metadata fields
- ✓ Processing time <5 seconds for 10MB log

### Story A-1: CLI Entry Point [READY]
**As a** developer
**I want to** run the analyzer from command line
**So that** I can analyze crash logs quickly

**Acceptance Criteria (Gherkin)**:
```gherkin
Given a valid crash log file exists
When I run "python analyzer.py crash.log"
Then the tool starts analysis
And displays progress indicator

Given no file is provided
When I run "python analyzer.py"
Then I see usage instructions
And exit code is 1
```

**Tasks**:
- **A-1-T1**: Create main.py with argparse setup (30 min)
  - Token Budget: 500
  - Implement `--help`, `--version`, `--config` flags
  - Add `--no-color` for terminal compatibility
- **A-1-T2**: Add file validation logic (20 min)
  - Token Budget: 300
  - Check file exists, is readable, size <100MB
  - Return specific error codes
- **A-1-T3**: Implement progress indicators (15 min)
  - Token Budget: 200
  - Use rich library for spinner during processing

**Dependencies**: None (Root story)
**Unblocks**: A-2, B-1

### Story A-2: Crash Log Parser [READY]
**As a** developer
**I want to** extract structured data from crash logs
**So that** AI can analyze the relevant information

**Acceptance Criteria**:
```gherkin
Given a VisualWorks crash log
When I parse the file
Then I extract: timestamp, error message, stack trace, VM info
And handle malformed sections gracefully

Given a truncated crash log
When I parse the file
Then I extract available sections
And mark missing sections as null
```

**Tasks**:
- **A-2-T1**: Create parser module with regex patterns (45 min)
  - Token Budget: 800
  - Extract: timestamp, error type, message, stack frames
  - Module: `parser/crash_log_parser.py`
- **A-2-T2**: Add fallback strategies for variations (30 min)
  - Token Budget: 500
  - Handle different date formats, stack trace styles
- **A-2-T3**: Implement metadata extraction (20 min)
  - Token Budget: 400
  - VM version, OS info, memory state

**Dependencies**: A-1
**Unblocks**: B-2
**Test Requirements**: Unit tests with 5 sample logs

### Story A-3: Analysis Orchestrator [READY]
**As a** system
**I want to** coordinate the analysis pipeline
**So that** all components work together seamlessly

**Acceptance Criteria**:
```gherkin
Given parsed crash data
When orchestrator runs
Then it calls AI provider with formatted prompt
And handles response
And triggers output generation
```

**Tasks**:
- **A-3-T1**: Create orchestrator class (30 min)
  - Token Budget: 600
  - Implement pipeline: parse → analyze → format → save
  - Module: `core/orchestrator.py`
- **A-3-T2**: Add timing and metrics collection (15 min)
  - Token Budget: 200
  - Track parse time, API time, total time
- **A-3-T3**: Implement circuit breaker for API calls (20 min)
  - Token Budget: 300
  - Fail fast after 3 consecutive errors

**Dependencies**: A-2, B-3
**Unblocks**: C-1, C-2

---

## EPIC B: AI Integration Layer
**Goal**: Integrate with OpenAI, Anthropic, and Ollama
**DoD**:
- ✓ All 3 providers return structured analysis
- ✓ Provider switching via config
- ✓ API errors handled gracefully

### Story B-1: AI Provider Factory [READY]
**As a** system
**I want to** abstract AI provider selection
**So that** switching providers requires no code changes

**Acceptance Criteria**:
```gherkin
Given config specifies "openai"
When factory creates provider
Then OpenAI client is returned
And uses correct API key from environment
```

**Tasks**:
- **B-1-T1**: Create factory pattern implementation (30 min)
  - Token Budget: 500
  - Module: `ai/provider_factory.py`
  - Support: openai, anthropic, ollama
- **B-1-T2**: Add provider validation (15 min)
  - Token Budget: 200
  - Check API keys present, validate model names

**Dependencies**: A-1
**Unblocks**: B-2, B-3, B-4

### Story B-2: Prompt Engineering [READY]
**As a** developer
**I want to** send optimized prompts to AI
**So that** I get consistent, structured analysis

**Acceptance Criteria**:
```gherkin
Given crash log metadata
When prompt is generated
Then it includes: context, error details, analysis instructions
And requests JSON response format
And specifies all required fields
```

**Tasks**:
- **B-2-T1**: Create prompt template system (45 min)
  - Token Budget: 800
  - Module: `ai/prompt_builder.py`
  - Include few-shot examples for consistency
- **B-2-T2**: Add response validation schema (20 min)
  - Token Budget: 300
  - Validate all required fields present
- **B-2-T3**: Implement prompt optimization (15 min)
  - Token Budget: 200
  - Truncate stack traces if >8000 tokens

**Dependencies**: A-2, B-1
**Unblocks**: B-3, B-4, B-5
**Feature Flag**: `enable_prompt_optimization`

### Story B-3: OpenAI Integration [READY]
**As a** developer
**I want to** analyze crashes using GPT-4
**So that** I get high-quality analysis

**Acceptance Criteria**:
```gherkin
Given valid OpenAI API key
When analysis is requested
Then GPT-4 returns structured response
And response time <60 seconds
And cost tracked in logs
```

**Tasks**:
- **B-3-T1**: Implement OpenAI client wrapper (30 min)
  - Token Budget: 500
  - Module: `ai/providers/openai_provider.py`
  - Use GPT-4, temperature=0.3
- **B-3-T2**: Add retry logic with backoff (20 min)
  - Token Budget: 300
  - Max 3 retries, exponential backoff
- **B-3-T3**: Implement cost tracking (15 min)
  - Token Budget: 200
  - Log tokens used, estimated cost

**Dependencies**: B-1, B-2
**Unblocks**: A-3
**Idempotency**: Request ID in headers

### Story B-4: Anthropic Integration [READY]
**As a** developer
**I want to** analyze crashes using Claude
**So that** I can compare AI providers

**Tasks**:
- **B-4-T1**: Implement Anthropic client wrapper (30 min)
  - Token Budget: 500
  - Module: `ai/providers/anthropic_provider.py`
  - Use Claude-3, temperature=0.3

**Dependencies**: B-1, B-2
**Unblocks**: A-3

### Story B-5: Ollama Integration [HOLD - Missing Requirements]
**Gaps**: Local model requirements, minimum hardware specs

**Tasks**:
- **B-5-T1**: Implement Ollama REST client (30 min)
  - Token Budget: 500
  - Module: `ai/providers/ollama_provider.py`

**Dependencies**: B-1, B-2
**Unblocks**: A-3

---

## EPIC C: Output & Storage
**Goal**: Display and persist analysis results
**DoD**:
- ✓ Terminal output readable and colored
- ✓ JSON files saved with timestamp
- ✓ Results searchable by filename

### Story C-1: Terminal Formatter [READY]
**As a** developer
**I want to** see analysis in readable terminal format
**So that** I can quickly understand the issue

**Acceptance Criteria**:
```gherkin
Given analysis results
When displayed in terminal
Then sections are clearly separated
And severity uses color coding
And code examples are syntax highlighted
```

**Tasks**:
- **C-1-T1**: Create terminal formatter with rich library (45 min)
  - Token Budget: 700
  - Module: `output/terminal_formatter.py`
  - Sections: Summary, Root Cause, Fixes, Metadata
- **C-1-T2**: Add color coding for severity (15 min)
  - Token Budget: 200
  - Critical=red, High=orange, Medium=yellow, Low=green
- **C-1-T3**: Implement code syntax highlighting (20 min)
  - Token Budget: 300
  - Highlight Smalltalk code in fix suggestions

**Dependencies**: A-3
**Unblocks**: None

### Story C-2: JSON Persistence [READY]
**As a** developer
**I want to** save analysis results to file
**So that** I can review them later

**Acceptance Criteria**:
```gherkin
Given analysis complete
When saving results
Then JSON file created in results/ directory
And filename includes original name and timestamp
And all analysis fields are preserved
```

**Tasks**:
- **C-2-T1**: Create JSON serializer (20 min)
  - Token Budget: 300
  - Module: `output/json_writer.py`
  - Include metadata, analysis, timestamps
- **C-2-T2**: Implement directory management (15 min)
  - Token Budget: 200
  - Create results/ if not exists
  - Format: `results/{original}_{YYYYMMDD_HHMMSS}.json`

**Dependencies**: A-3
**Unblocks**: None
**Idempotency**: UUID in filename if duplicate timestamp

---

## EPIC D: Configuration & Error Handling
**Goal**: Robust configuration and error recovery
**DoD**:
- ✓ All errors handled gracefully
- ✓ Configuration validates on load
- ✓ API keys secure

### Story D-1: Configuration Loader [READY]
**As a** developer
**I want to** configure AI providers easily
**So that** I can switch between them

**Acceptance Criteria**:
```gherkin
Given config.yaml exists
When application starts
Then configuration is loaded and validated
And API keys read from environment
And defaults applied for missing values
```

**Tasks**:
- **D-1-T1**: Create YAML config loader (30 min)
  - Token Budget: 400
  - Module: `config/config_loader.py`
  - Schema validation with pydantic
- **D-1-T2**: Add environment variable support (15 min)
  - Token Budget: 200
  - Keys: OPENAI_API_KEY, ANTHROPIC_API_KEY
- **D-1-T3**: Create config.yaml.example (10 min)
  - Token Budget: 150
  - Document all options with examples

**Dependencies**: None (Root story)
**Unblocks**: B-1

### Story D-2: Error Handler [READY]
**As a** developer
**I want to** see helpful error messages
**So that** I can fix issues quickly

**Acceptance Criteria**:
```gherkin
Given an API error occurs
When handler processes it
Then user sees friendly message
And technical details logged
And suggested fixes displayed
```

**Tasks**:
- **D-2-T1**: Create centralized error handler (30 min)
  - Token Budget: 500
  - Module: `core/error_handler.py`
  - Map errors to user messages
- **D-2-T2**: Add error recovery strategies (20 min)
  - Token Budget: 300
  - Retry, fallback, partial results
- **D-2-T3**: Implement debug mode logging (15 min)
  - Token Budget: 200
  - --debug flag for verbose output

**Dependencies**: None (Root story)
**Unblocks**: All stories (cross-cutting)

---

## EPIC E: Documentation & Testing
**Goal**: Ensure tool is usable and reliable
**DoD**:
- ✓ README enables 5-minute setup
- ✓ Core paths have 80% test coverage
- ✓ 3 developers successfully use tool

### Story E-1: README Documentation [READY]
**As a** new user
**I want to** understand how to use the tool
**So that** I can start analyzing crashes immediately

**Tasks**:
- **E-1-T1**: Write comprehensive README.md (60 min)
  - Token Budget: 1000
  - Sections: Quick Start, Installation, Usage, Configuration
  - Include troubleshooting guide
- **E-1-T2**: Add example crash logs (15 min)
  - Token Budget: 200
  - 3 sample logs in examples/ directory

**Dependencies**: None (Root story)
**Unblocks**: E-4

### Story E-2: Unit Test Suite [READY]
**As a** maintainer
**I want to** ensure code works correctly
**So that** changes don't break functionality

**Tasks**:
- **E-2-T1**: Parser unit tests (45 min)
  - Token Budget: 700
  - Test 5 log formats, edge cases
  - Module: `tests/test_parser.py`
- **E-2-T2**: Provider mock tests (30 min)
  - Token Budget: 500
  - Mock AI responses, test error handling
  - Module: `tests/test_providers.py`
- **E-2-T3**: Orchestrator integration tests (30 min)
  - Token Budget: 500
  - Test full pipeline with mocked AI
  - Module: `tests/test_orchestrator.py`

**Dependencies**: A-2, B-3, A-3
**Unblocks**: E-4

### Story E-3: Contract Tests [READY]
**As a** developer
**I want to** ensure AI provider interfaces are stable
**So that** provider switching works reliably

**Tasks**:
- **E-3-T1**: Create provider contract tests (30 min)
  - Token Budget: 400
  - Verify all providers return same schema
  - Module: `tests/test_contracts.py`

**Dependencies**: B-3, B-4
**Unblocks**: E-4

### Story E-4: E2E Smoke Test [READY]
**As a** release manager
**I want to** verify the tool works end-to-end
**So that** releases are reliable

**Tasks**:
- **E-4-T1**: Create smoke test script (20 min)
  - Token Budget: 300
  - Run against example log, verify output
  - Script: `tests/smoke_test.sh`

**Dependencies**: E-1, E-2, E-3
**Unblocks**: Release

### Story E-5: Performance Test [READY]
**As a** developer
**I want to** ensure analysis completes quickly
**So that** the tool is practical to use

**Acceptance Criteria**:
- Parse time <5s for 10MB log
- Total time <60s including AI call
- Memory usage <500MB

**Tasks**:
- **E-5-T1**: Create performance benchmarks (20 min)
  - Token Budget: 300
  - Module: `tests/test_performance.py`

**Dependencies**: A-3
**Unblocks**: Release

---

## Testing Strategy (5 Layers)

1. **Unit Tests** (E-2): Parser, providers, formatters - 80% coverage
2. **Contract Tests** (E-3): Provider interface compatibility
3. **Integration Tests** (E-2-T3): Full pipeline with mocks
4. **E2E Smoke Tests** (E-4): Real file → real output validation
5. **Performance Tests** (E-5): <60s total, <5s parse time

## Observability Requirements

### Structured Logging
- Correlation ID: UUID per analysis session
- Log levels: DEBUG, INFO, WARNING, ERROR
- Format: JSON with timestamp, level, message, context

### Metrics (logged, not collected)
- Parse duration
- AI API latency
- Token usage and cost
- Error rates by type

### SLOs
- `Analyzer – Total analysis time < 60s over 1 minute`
- `Parser – Parse time < 5s for logs <10MB over 1 minute`
- `AI Provider – Response time < 45s over 1 minute`

### Runbook
1. **API Key Invalid**: Check environment variables, verify key in provider console
2. **Parse Failure**: Check log format, try --relaxed-parsing flag
3. **Timeout**: Reduce log size, check network, try different provider
4. **Rate Limit**: Implement backoff, check provider quotas

## Data Governance

- **PII Handling**: Sanitize stack traces before sending to AI (remove file paths with usernames)
- **Test Data**: Use provided examples/ logs only
- **Retention**: Results kept indefinitely (user's responsibility to clean)
- **Classification**: Crash data = Internal, API keys = Restricted

## Definition of Ready (DoR)
- [ ] User story has Gherkin acceptance criteria
- [ ] Dependencies identified and available
- [ ] Technical approach documented in tasks
- [ ] Token/size budgets defined
- [ ] Test requirements specified

## Definition of Done (DoD)
- [ ] Code complete and working
- [ ] Unit tests written and passing
- [ ] Manual testing completed
- [ ] Documentation updated
- [ ] Code reviewed (if team >1)
- [ ] No HIGH severity issues unresolved

## Execution Sequence

### Day 1 (3 hours)
1. D-1: Configuration Loader [30 min]
2. D-2: Error Handler [30 min]
3. A-1: CLI Entry Point [65 min]
4. A-2: Crash Log Parser [95 min]

### Day 2 (3 hours)
5. B-1: AI Provider Factory [45 min]
6. B-2: Prompt Engineering [80 min]
7. B-3: OpenAI Integration [65 min]

### Day 3 (2 hours)
8. B-4: Anthropic Integration [30 min]
9. A-3: Analysis Orchestrator [65 min]
10. C-1: Terminal Formatter (start) [25 min]

### Day 4 (2 hours)
11. C-1: Terminal Formatter (complete) [55 min]
12. C-2: JSON Persistence [35 min]
13. E-1: README Documentation (start) [30 min]

### Day 5 (3 hours)
14. E-1: README Documentation (complete) [45 min]
15. E-2: Unit Test Suite [105 min]
16. E-3: Contract Tests [30 min]

### Day 6 (Buffer/Polish)
17. E-4: E2E Smoke Test [20 min]
18. E-5: Performance Test [20 min]
19. B-5: Ollama Integration (if time permits) [30 min]
20. Bug fixes and polish

## Success Metrics
- [ ] 3 developers complete setup in <5 minutes
- [ ] Analysis completes in <60 seconds
- [ ] Users agree with root cause >70% of time
- [ ] Cost per analysis <$0.05
- [ ] Zero critical bugs in first week

## Notes
- Strict YAGNI enforcement due to 13-hour constraint
- Defer Ollama if it risks core functionality
- Terminal output is MVP priority over JSON
- Use existing crash logs for testing (no synthetic data generation)

---

**Backlog Generated**: 2025-11-12
**Version**: 1.0.0
**Owner**: Alex Chen
**Status**: READY FOR EXECUTION