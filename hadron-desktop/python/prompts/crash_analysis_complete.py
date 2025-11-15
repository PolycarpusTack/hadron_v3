"""
Crash Analysis Prompt - Complete Analysis Type
Based on COMMAND 1: Comprehensive standalone analysis with 10 structured parts
"""

SYSTEM_PROMPT = """You are an expert VisualWorks Smalltalk developer with 15+ years of experience debugging production issues.

Your expertise includes:
- Message-passing semantics and method lookup
- Common Smalltalk pitfalls (nil receivers, missing selectors, block closures)
- VisualWorks-specific classes (OrderedCollection, Dictionary, etc.)
- Stack trace analysis and error propagation
- Production incident management and remediation

You provide comprehensive, structured analysis that helps both developers and management understand crashes."""

USER_PROMPT_TEMPLATE = """Analyze this VisualWorks Smalltalk crash log with a COMPLETE, COMPREHENSIVE approach.

CRASH LOG:
{crash_content}

PROVIDE A COMPLETE ANALYSIS WITH THESE 10 STRUCTURED PARTS:

## PART 1: Structured Metadata Extraction (JSON format)
Extract:
- Error classification (MessageNotUnderstood, NullPointer, etc.)
- Timestamp and environment info
- Affected component/class
- Severity level (CRITICAL/HIGH/MEDIUM/LOW)

## PART 2: Error Classification
Provide detailed error categorization:
- Primary error type
- Secondary characteristics
- Error family (e.g., message passing errors, memory errors, etc.)

## PART 3: User Action Reconstruction
Reconstruct the user's actions that led to this crash:
- What was the user trying to do?
- What workflow were they in?
- What inputs were provided?

## PART 4: Root Cause Analysis - Technical View
Deep technical explanation:
- Immediate cause (what failed)
- Underlying technical reason (why it failed)
- Code path that led to failure

## PART 5: Root Cause Analysis - Functional View
Business/functional perspective:
- What business function failed?
- Impact on user workflow
- Data integrity concerns

## PART 6: Developer Remediation (Prioritized)
**P0 (Critical - Fix Immediately):**
- Hotfix solutions with code examples
- Quick patches to restore service

**P1 (High Priority - Fix This Sprint):**
- Proper fixes with refactoring
- Defensive programming additions

**P2 (Enhancement - Next Sprint):**
- Architectural improvements
- Preventive measures

Each fix should include:
- Exact method/class to change
- Smalltalk code snippet
- Why it works

## PART 7: User/Functional Remediation
For support teams:
- Workarounds users can take
- Data recovery steps
- Communication points for customers

## PART 8: Reproduction Steps
Detailed steps to reproduce:
1. Step-by-step actions
2. Required preconditions
3. Expected vs actual behavior

## PART 9: Monitoring & Detection
How to detect this earlier:
- Log patterns to watch for
- Metrics to monitor
- Alerts to configure

## PART 10: Similar Issues Tracking
Reference related problems:
- Common patterns this fits into
- Historical similar issues
- Knowledge base references

OUTPUT FORMAT (JSON):
{{
  "metadata": {{
    "error_type": "MessageNotUnderstood | NullPointer | etc.",
    "error_message": "Brief summary",
    "timestamp": "Extracted timestamp if available",
    "component": "ClassName or ModuleName",
    "severity": "CRITICAL | HIGH | MEDIUM | LOW",
    "confidence": "HIGH | MEDIUM | LOW"
  }},
  "error_classification": {{
    "primary_type": "Main error category",
    "secondary_characteristics": ["Characteristic 1", "Characteristic 2"],
    "error_family": "Error family name"
  }},
  "user_action_reconstruction": {{
    "intended_action": "What user was trying to do",
    "workflow_context": "Current workflow",
    "inputs_provided": "User inputs"
  }},
  "root_cause_technical": {{
    "immediate_cause": "What failed",
    "underlying_reason": "Why it failed",
    "code_path": "Path through code to failure"
  }},
  "root_cause_functional": {{
    "business_function": "Failed business function",
    "workflow_impact": "Impact on user workflow",
    "data_integrity": "Data concerns"
  }},
  "developer_remediation": {{
    "p0_critical": [
      {{
        "description": "Hotfix description",
        "code_snippet": "Smalltalk code",
        "rationale": "Why this works"
      }}
    ],
    "p1_high_priority": [
      {{
        "description": "Proper fix description",
        "code_snippet": "Smalltalk code",
        "rationale": "Why this works"
      }}
    ],
    "p2_enhancement": [
      {{
        "description": "Architectural improvement",
        "code_snippet": "Smalltalk code if applicable",
        "rationale": "Why this prevents future issues"
      }}
    ]
  }},
  "user_remediation": {{
    "workarounds": ["Workaround 1", "Workaround 2"],
    "data_recovery": ["Recovery step 1", "Recovery step 2"],
    "communication_points": ["What to tell users"]
  }},
  "reproduction_steps": {{
    "preconditions": ["Precondition 1", "Precondition 2"],
    "steps": ["Step 1", "Step 2", "Step 3"],
    "expected_behavior": "What should happen",
    "actual_behavior": "What actually happens"
  }},
  "monitoring_detection": {{
    "log_patterns": ["Pattern 1 to watch", "Pattern 2 to watch"],
    "metrics": ["Metric 1 to monitor", "Metric 2 to monitor"],
    "alerts": ["Alert 1 to configure", "Alert 2 to configure"]
  }},
  "similar_issues": {{
    "common_patterns": ["Pattern 1", "Pattern 2"],
    "historical_issues": ["Issue reference 1", "Issue reference 2"],
    "knowledge_base": ["KB article 1", "KB article 2"]
  }},
  "stack_trace": "Parsed stack trace if available"
}}

IMPORTANT: Return ONLY valid JSON, no markdown formatting or explanation.
Provide comprehensive, actionable analysis in all 10 parts."""

def get_prompt(crash_content: str, context: dict = None) -> dict:
    """
    Generate prompts for complete crash analysis.

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
        "version": "3.0-complete",
        "metadata": {
            "type": "complete",
            "optimized_for": ["Comprehensive analysis", "10-part structured output"],
            "includes": [
                "Metadata extraction",
                "Error classification",
                "User action reconstruction",
                "Technical root cause",
                "Functional root cause",
                "Prioritized remediation (P0/P1/P2)",
                "User workarounds",
                "Reproduction steps",
                "Monitoring guidance",
                "Similar issues tracking"
            ]
        }
    }
