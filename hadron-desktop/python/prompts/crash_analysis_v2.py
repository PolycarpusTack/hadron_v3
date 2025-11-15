"""
Crash Analysis Prompt Template v2.0
Improved: Better Smalltalk context, structured output, confidence scoring
"""

SYSTEM_PROMPT = """You are an expert VisualWorks Smalltalk developer with 15+ years of experience debugging production issues.

Your expertise includes:
- Message-passing semantics and method lookup
- Common Smalltalk pitfalls (nil receivers, missing selectors, block closures)
- VisualWorks-specific classes (OrderedCollection, Dictionary, etc.)
- Stack trace analysis and error propagation

Always provide actionable, specific fixes with code examples when possible."""

USER_PROMPT_TEMPLATE = """Analyze this VisualWorks Smalltalk crash log and provide a detailed diagnosis.

CRASH LOG:
{crash_content}

ANALYSIS REQUIREMENTS:
1. **Error Classification**: Identify the exact error type (MessageNotUnderstood, NullPointer, etc.)
2. **Root Cause**: Explain WHY this happened in Smalltalk terms (receiver was nil, method not found, etc.)
3. **Affected Component**: Which class/module is involved
4. **Confidence Level**: How certain are you? (HIGH/MEDIUM/LOW)

PROVIDE SPECIFIC FIXES:
For each suggested fix, include:
- What to change (exact method/class)
- Why it will work
- Smalltalk code snippet if applicable

Example fix format:
"Add nil check before sending #formatDate: message to prevent MessageNotUnderstood. In UserManager>>updateTimestamp, change:
  date formatDate: 'YYYY-MM-DD'
to:
  date ifNotNil: [date formatDate: 'YYYY-MM-DD'] ifNil: [Date today formatDate: 'YYYY-MM-DD']"

OUTPUT FORMAT (JSON):
{{
  "error_type": "MessageNotUnderstood | NullPointer | IndexOutOfBounds | KeyNotFound | etc.",
  "error_message": "Brief summary (e.g., 'Object does not understand #formatDate:')",
  "root_cause": "2-3 sentences explaining the underlying issue in Smalltalk context",
  "component": "ClassName or ModuleName",
  "stack_trace": "Parsed stack trace if available",
  "suggested_fixes": [
    "Fix 1: Specific solution with code",
    "Fix 2: Alternative approach",
    "Fix 3: Defensive programming (if applicable)"
  ],
  "severity": "critical | high | medium | low",
  "confidence": "HIGH | MEDIUM | LOW",
  "smalltalk_context": {{
    "receiver_type": "Expected class of receiver (if known)",
    "selector": "Method selector that failed",
    "related_classes": ["Classes involved in the error chain"]
  }}
}}

IMPORTANT: Return ONLY valid JSON, no markdown formatting."""

def get_prompt(crash_content: str, context: dict = None) -> dict:
    """
    Generate prompts for crash analysis.

    Args:
        crash_content: The raw crash log text
        context: Optional context (file size, truncation info, etc.)

    Returns:
        dict with 'system' and 'user' prompts
    """
    # Add truncation warning if needed
    if context and context.get('was_truncated'):
        truncation_note = f"\n\nNOTE: This log was truncated (original size: {context.get('original_size_kb', 'unknown')} KB). Analysis is based on available content."
        content = crash_content + truncation_note
    else:
        content = crash_content

    return {
        "system": SYSTEM_PROMPT,
        "user": USER_PROMPT_TEMPLATE.format(crash_content=content),
        "version": "2.0",
        "metadata": {
            "optimized_for": ["VisualWorks Smalltalk", "MessageNotUnderstood", "nil receivers"],
            "improvements": [
                "Added Smalltalk-specific context",
                "Better code example format",
                "Structured JSON output with confidence",
                "Explicit error classification taxonomy"
            ]
        }
    }

# Legacy v1 prompt for comparison/fallback
def get_v1_prompt(crash_content: str) -> dict:
    """Original simpler prompt - kept for A/B testing"""
    return {
        "system": "You are an expert Smalltalk developer analyzing crash logs. Always return valid JSON.",
        "user": f"""Analyze this VisualWorks Smalltalk crash log and provide a structured response.

CRASH LOG:
{crash_content}

Provide your analysis in this JSON format:
{{
  "error_type": "Brief error classification",
  "root_cause": "2-3 sentence explanation",
  "suggested_fixes": ["Fix 1", "Fix 2", "Fix 3"],
  "severity": "critical|high|medium|low",
  "affected_component": "Which module/class",
  "confidence": "high|medium|low"
}}

Return ONLY valid JSON.""",
        "version": "1.0"
    }
