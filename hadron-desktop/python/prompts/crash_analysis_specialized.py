"""
Crash Analysis Prompt - Specialized Analyses Suite Type
Based on COMMAND 2: Execute 8 focused analyses in sequence
"""

SYSTEM_PROMPT = """You are an expert VisualWorks Smalltalk developer with 15+ years of experience debugging production issues.

Your expertise includes:
- Message-passing semantics and method lookup
- Common Smalltalk pitfalls (nil receivers, missing selectors, block closures)
- VisualWorks-specific classes (OrderedCollection, Dictionary, etc.)
- Stack trace analysis and error propagation
- Performance analysis and memory management
- Database integration patterns
- Production system optimization

You provide specialized, focused analyses across multiple dimensions."""

USER_PROMPT_TEMPLATE = """Analyze this VisualWorks Smalltalk crash log using 8 SPECIALIZED ANALYSIS PERSPECTIVES.

CRASH LOG:
{crash_content}

Execute these 8 SPECIALIZED ANALYSES in sequence:

## ANALYSIS 1: PATTERN ANALYSIS
Identify patterns and recurring themes:
- Error patterns (message passing, nil handling, etc.)
- Code smell patterns
- Anti-patterns detected
- Architectural patterns involved

## ANALYSIS 2: RECOMMENDATIONS ANALYSIS
Provide specific, actionable recommendations:
- Immediate fixes needed
- Code refactoring suggestions
- Best practices to apply
- Testing strategies
- Documentation improvements

## ANALYSIS 3: MEMORY ANALYSIS
Deep dive into memory-related aspects:
- Memory allocation issues
- Object lifecycle problems
- Garbage collection concerns
- Memory leaks (if any)
- Reference chain issues
- Memory optimization opportunities

## ANALYSIS 4: DATABASE ANALYSIS
Database and persistence layer examination:
- Database connection issues
- Query problems
- Transaction handling
- Data integrity concerns
- ORM/persistence layer issues
- Database performance bottlenecks

## ANALYSIS 5: PERFORMANCE ANALYSIS
Performance characteristics and bottlenecks:
- Computational complexity issues
- Algorithm efficiency problems
- Resource utilization concerns
- Scalability issues
- Performance hotspots
- Optimization opportunities

## ANALYSIS 6: ROOT CAUSE ANALYSIS (Deep)
Ultra-detailed root cause investigation:
- Primary failure point
- Contributing factors (1st, 2nd, 3rd order)
- Propagation chain
- Hidden dependencies
- Environmental factors
- Timing/concurrency issues
- State corruption analysis

## ANALYSIS 7: GENERAL ANALYSIS
Holistic view and general observations:
- Overall system health indicators
- Cross-cutting concerns
- Integration points affected
- Business logic implications
- User experience impact
- Testing gaps exposed

## ANALYSIS 8: BASIC ANALYSIS
Quick reference fundamentals:
- Error type (simple classification)
- Severity level
- Affected component
- Quick fix summary (one-liner)
- Estimated fix time
- Risk level of fix

OUTPUT FORMAT (JSON):
{{
  "pattern_analysis": {{
    "error_patterns": ["Pattern 1", "Pattern 2"],
    "code_smells": ["Smell 1", "Smell 2"],
    "anti_patterns": ["Anti-pattern 1", "Anti-pattern 2"],
    "architectural_patterns": ["Pattern 1", "Pattern 2"]
  }},
  "recommendations_analysis": {{
    "immediate_fixes": [
      {{
        "priority": "P0/P1/P2",
        "description": "Fix description",
        "code_snippet": "Smalltalk code",
        "estimated_effort": "Time estimate"
      }}
    ],
    "refactoring_suggestions": ["Suggestion 1", "Suggestion 2"],
    "best_practices": ["Practice 1", "Practice 2"],
    "testing_strategies": ["Strategy 1", "Strategy 2"],
    "documentation_needs": ["Doc need 1", "Doc need 2"]
  }},
  "memory_analysis": {{
    "allocation_issues": ["Issue 1", "Issue 2"],
    "lifecycle_problems": ["Problem 1", "Problem 2"],
    "gc_concerns": ["Concern 1", "Concern 2"],
    "memory_leaks": ["Leak 1 (if any)", "Leak 2 (if any)"],
    "reference_issues": ["Issue 1", "Issue 2"],
    "optimization_opportunities": ["Opportunity 1", "Opportunity 2"]
  }},
  "database_analysis": {{
    "connection_issues": ["Issue 1 (if any)", "Issue 2 (if any)"],
    "query_problems": ["Problem 1 (if any)", "Problem 2 (if any)"],
    "transaction_handling": ["Concern 1 (if any)", "Concern 2 (if any)"],
    "data_integrity": ["Integrity concern 1 (if any)", "Integrity concern 2 (if any)"],
    "orm_issues": ["Issue 1 (if any)", "Issue 2 (if any)"],
    "performance_bottlenecks": ["Bottleneck 1 (if any)", "Bottleneck 2 (if any)"]
  }},
  "performance_analysis": {{
    "complexity_issues": ["Issue 1", "Issue 2"],
    "algorithm_efficiency": ["Problem 1", "Problem 2"],
    "resource_utilization": ["Concern 1", "Concern 2"],
    "scalability_issues": ["Issue 1", "Issue 2"],
    "hotspots": ["Hotspot 1", "Hotspot 2"],
    "optimizations": ["Optimization 1", "Optimization 2"]
  }},
  "root_cause_deep": {{
    "primary_failure": "Main failure point",
    "contributing_factors": {{
      "first_order": ["Factor 1", "Factor 2"],
      "second_order": ["Factor 1", "Factor 2"],
      "third_order": ["Factor 1", "Factor 2"]
    }},
    "propagation_chain": ["Step 1", "Step 2", "Step 3"],
    "hidden_dependencies": ["Dependency 1", "Dependency 2"],
    "environmental_factors": ["Factor 1", "Factor 2"],
    "timing_issues": ["Issue 1 (if any)", "Issue 2 (if any)"],
    "state_corruption": ["Corruption 1 (if any)", "Corruption 2 (if any)"]
  }},
  "general_analysis": {{
    "system_health": "Overall health indicator",
    "cross_cutting_concerns": ["Concern 1", "Concern 2"],
    "integration_impacts": ["Impact 1", "Impact 2"],
    "business_logic_implications": ["Implication 1", "Implication 2"],
    "user_experience_impact": "UX impact description",
    "testing_gaps": ["Gap 1", "Gap 2"]
  }},
  "basic_analysis": {{
    "error_type": "Simple classification",
    "severity": "CRITICAL | HIGH | MEDIUM | LOW",
    "affected_component": "Component name",
    "quick_fix": "One-line fix summary",
    "estimated_fix_time": "Time estimate (hours/days)",
    "fix_risk_level": "LOW | MEDIUM | HIGH"
  }},
  "stack_trace": "Parsed stack trace if available",
  "confidence": "HIGH | MEDIUM | LOW"
}}

IMPORTANT: Return ONLY valid JSON, no markdown formatting or explanation.
Provide thorough analysis in all 8 specialized perspectives."""

def get_prompt(crash_content: str, context: dict = None) -> dict:
    """
    Generate prompts for specialized analyses suite.

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
        "version": "3.0-specialized",
        "metadata": {
            "type": "specialized",
            "optimized_for": ["Multi-dimensional analysis", "8 specialized perspectives"],
            "includes": [
                "Pattern Analysis",
                "Recommendations Analysis",
                "Memory Analysis",
                "Database Analysis",
                "Performance Analysis",
                "Deep Root Cause Analysis",
                "General Analysis",
                "Basic Analysis"
            ]
        }
    }
