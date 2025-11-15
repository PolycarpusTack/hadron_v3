# Testing Multi-Provider AI Integration

## Phase 3 Testing Guide - All Providers (OpenAI, Anthropic, Z.ai)

### Prerequisites

1. Install dependencies:
```bash
cd python
pip install -r requirements.txt
```

2. Get API keys:
   - **OpenAI**: https://platform.openai.com (starts with `sk-`)
   - **Anthropic**: https://console.anthropic.com (starts with `sk-ant-`)
   - **Z.ai**: https://z.ai (subscription-based)

---

## Test 1: OpenAI (Default)

### Using GPT-4 Turbo

```bash
# Set environment variables
export AI_PROVIDER=openai
export AI_MODEL=gpt-4-turbo-preview
export AI_API_KEY=sk-YOUR-OPENAI-KEY

# Run analysis
python analyze_json.py ../test-crashes/sample-crash.txt
```

### Expected Output
```json
{
  "error_type": "MessageNotUnderstood",
  "error_message": "nil does not understand #formatDate:",
  "root_cause": "...",
  "suggested_fixes": [...],
  "provider": "openai",
  "prompt_version": "2.0",
  "cost": 0.015
}
```

### Verify
- ✅ `provider: "openai"`
- ✅ `prompt_version: "2.0"` (using v2 prompts)
- ✅ Cost is reasonable (~$0.01-0.03 per analysis)
- ✅ stderr shows: `Using prompt version: 2.0`

---

## Test 2: Anthropic Claude

### Using Claude 3.5 Sonnet

```bash
# Set environment variables
export AI_PROVIDER=anthropic
export AI_MODEL=claude-3-5-sonnet-20241022
export AI_API_KEY=sk-ant-YOUR-ANTHROPIC-KEY

# Run analysis
python analyze_json.py ../test-crashes/sample-crash.txt
```

### Expected Output
```json
{
  "error_type": "MessageNotUnderstood",
  "error_message": "nil does not understand #formatDate:",
  "root_cause": "...",
  "suggested_fixes": [...],
  "provider": "anthropic",
  "prompt_version": "2.0",
  "tokens_used": 1500,
  "cost": 0.0135
}
```

### Verify
- ✅ `provider: "anthropic"`
- ✅ `prompt_version: "2.0"`
- ✅ Cost is accurate (~$0.009 per 1K tokens)
- ✅ stderr shows: `Using prompt version: 2.0`
- ✅ Response uses Claude's superior reasoning

### Test Other Claude Models

```bash
# Claude Haiku (fastest, cheapest)
export AI_MODEL=claude-3-haiku-20240307

# Claude Opus (most capable, expensive)
export AI_MODEL=claude-3-opus-20240229
```

---

## Test 3: Z.ai (GLM)

### Using GLM-4.6

```bash
# Set environment variables
export AI_PROVIDER=zai
export AI_MODEL=glm-4.6
export AI_API_KEY=YOUR-ZAI-API-KEY

# Run analysis
python analyze_json.py ../test-crashes/sample-crash.txt
```

### Expected Output
```json
{
  "error_type": "MessageNotUnderstood",
  "root_cause": "...",
  "provider": "zai",
  "prompt_version": "2.0",
  "cost": 0.000015
}
```

### Verify
- ✅ `provider: "zai"`
- ✅ Cost is minimal (flat $3/month subscription)
- ✅ stderr shows: `Using prompt version: 2.0`

---

## Test 4: Prompt Template System

### Verify v2 Prompts Are Used

```bash
# Should see this in stderr:
# Using prompt version: 2.0

# Check that prompts/ directory exists
ls python/prompts/
# Expected: __init__.py  crash_analysis_v2.py
```

### Test Without Prompt Templates (Fallback to v1)

```bash
# Temporarily rename prompts directory
mv python/prompts python/prompts.backup

# Run analysis
python analyze_json.py ../test-crashes/sample-crash.txt

# Should see warning:
# Warning: Prompt templates not found, using inline prompts

# Output should show:
# "prompt_version": "1.0"

# Restore prompts
mv python/prompts.backup python/prompts
```

---

## Test 5: File Truncation

### Test with Large File (>400KB)

```bash
# Create large test file
python -c "print('Stack trace line\n' * 100000)" > large-crash.txt

# Run analysis
python analyze_json.py large-crash.txt
```

### Verify
- ✅ File is truncated intelligently (first 50% + last 25%)
- ✅ `was_truncated: true`
- ✅ Prompt includes truncation notice
- ✅ Analysis still works despite truncation

---

## Test 6: Error Handling

### Test Missing API Key

```bash
unset AI_API_KEY
python analyze_json.py ../test-crashes/sample-crash.txt

# Expected stderr:
# {"error": "No API key found. Set AI_API_KEY environment variable."}
```

### Test Invalid API Key

```bash
export AI_API_KEY=invalid-key
python analyze_json.py ../test-crashes/sample-crash.txt

# Expected stderr:
# {"error": "AI analysis failed: Invalid API key"}
```

### Test Invalid JSON Response

```bash
# This should rarely happen with v2 prompts, but test gracefully handles it
# Error message should show: "AI returned invalid JSON"
```

---

## Test 7: Cost Estimation

### Compare Costs Across Providers

```bash
# OpenAI GPT-4 Turbo (~$0.01-0.03 per analysis)
export AI_PROVIDER=openai AI_MODEL=gpt-4-turbo-preview

# Anthropic Claude Sonnet (~$0.009-0.015 per analysis)
export AI_PROVIDER=anthropic AI_MODEL=claude-3-5-sonnet-20241022

# Z.ai GLM (~$0.000015 per analysis, flat $3/month)
export AI_PROVIDER=zai AI_MODEL=glm-4.6
```

### Expected Cost Ranking
1. **Z.ai**: Nearly free (flat subscription)
2. **Claude Haiku**: $0.0008 per analysis
3. **Claude Sonnet**: $0.009 per analysis
4. **GPT-4 Turbo**: $0.01-0.03 per analysis
5. **Claude Opus**: $0.045 per analysis

---

## Test 8: Integration with UI

### Test from Hadron Desktop App

1. Start the app:
```bash
npm run tauri dev
```

2. Open Settings panel
3. Select different providers:
   - OpenAI → GPT-4 Turbo
   - Anthropic → Claude 3.5 Sonnet
   - Z.ai → GLM-4.6

4. Upload a crash log
5. Verify analysis works with each provider

---

## Test 9: Prompt v2 Quality Comparison

### A/B Test: v1 vs v2 Prompts

**v1 Prompts** (Generic):
- Less Smalltalk-specific
- No code examples in fixes
- Lower confidence scores

**v2 Prompts** (Smalltalk-Expert):
- Smalltalk expertise context
- Code examples in suggested_fixes
- Better root cause explanations
- Higher confidence scores

### Manual Quality Check

For the same crash log, compare:
1. Error classification accuracy
2. Root cause depth
3. Fix specificity (generic vs code examples)
4. Confidence appropriateness

**Expected Improvement**: v2 should have 15-20% better accuracy

---

## Test 10: Performance Benchmarks

### Measure Response Times

```bash
# Test each provider's latency
time python analyze_json.py test-crash.txt

# Expected latencies:
# GPT-4 Turbo: 3-5 seconds
# Claude Sonnet: 2-4 seconds
# Claude Haiku: 1-2 seconds (fastest)
# Z.ai GLM: 4-6 seconds
```

---

## Troubleshooting

### Error: "Anthropic package not installed"
```bash
pip install anthropic>=0.9.0
```

### Error: "Prompt templates not found"
```bash
# Verify prompts/ directory exists
ls python/prompts/

# Should contain:
# __init__.py
# crash_analysis_v2.py
```

### Error: "Invalid API key format"
- OpenAI keys start with `sk-`
- Anthropic keys start with `sk-ant-`
- Z.ai keys vary (check their docs)

---

## Success Criteria

All tests pass when:
- ✅ All 3 providers return valid JSON
- ✅ `prompt_version: "2.0"` in all responses
- ✅ `provider` field matches selected provider
- ✅ Costs are accurate for each provider
- ✅ v2 prompts provide better quality than v1
- ✅ Truncation works for large files
- ✅ Error handling is graceful

---

## Next Steps After Testing

1. **Response Caching**: Reduce duplicate API calls
2. **Circuit Breaker**: Handle provider failures gracefully
3. **PII Redaction**: Strip sensitive data before sending
4. **Prompt v3**: Experiment with few-shot examples

---

**Status**: Ready for testing all 3 providers with v2 prompts!
