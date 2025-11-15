#!/usr/bin/env python3
"""
Smalltalk Crash Analyzer - Week 1 MVP
Usage: python analyze.py crash-log.txt
"""

import sys
import json
import yaml
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional

try:
    from openai import OpenAI
except ImportError:
    print("Error: OpenAI package not installed. Run: pip install openai")
    sys.exit(1)


# Configuration Management
def load_config() -> Dict[str, Any]:
    """Load config from config.yaml or use defaults."""
    config_file = Path('config.yaml')

    if config_file.exists():
        with open(config_file, 'r') as f:
            config = yaml.safe_load(f)
    else:
        config = {
            'provider': 'openai',
            'model': 'gpt-4',
            'temperature': 0.3,
            'max_tokens': 2000
        }

    # API key from environment variable
    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key and config.get('provider') == 'openai':
        config['api_key'] = None
    else:
        config['api_key'] = api_key

    return config


# Crash Log Parser
def parse_crash_log(file_path: str, max_size_kb: int = 400) -> Dict[str, Any]:
    """Read and extract basic info from crash log.

    Args:
        file_path: Path to crash log file
        max_size_kb: Maximum content size to send to AI (default 400KB for GPT-4)

    For large files (>max_size_kb), intelligently truncates to keep:
    - First 50% (error info, stack trace)
    - Last 25% (recent context)
    - Middle section summary
    """
    try:
        # Get file size first
        file_size = Path(file_path).stat().st_size
        size_kb = file_size / 1024

        # Read full content
        content = Path(file_path).read_text(encoding='utf-8', errors='ignore')
        original_content = content
        is_truncated = False

        # Smart truncation for large files
        if size_kb > max_size_kb:
            is_truncated = True
            print(f"   ⚠️  File is {size_kb:.1f} KB, truncating to {max_size_kb} KB for AI analysis")

            # Calculate byte limits
            max_bytes = max_size_kb * 1024
            keep_start = int(max_bytes * 0.5)   # 50% from beginning (stack trace)
            keep_end = int(max_bytes * 0.25)    # 25% from end (recent logs)

            start_content = content[:keep_start]
            end_content = content[-keep_end:]

            # Add truncation notice
            truncation_notice = f"\n\n{'='*60}\n"
            truncation_notice += f"[TRUNCATED: Original file was {size_kb:.1f} KB]\n"
            truncation_notice += f"[Showing: First {keep_start/1024:.1f} KB + Last {keep_end/1024:.1f} KB]\n"
            truncation_notice += f"[Middle section omitted to fit AI context window]\n"
            truncation_notice += f"{'='*60}\n\n"

            content = start_content + truncation_notice + end_content

    except Exception as e:
        raise Exception(f"Failed to read crash log: {e}")

    lines = content.split('\n')

    return {
        'filename': Path(file_path).name,
        'raw_content': content,
        'original_size_kb': size_kb,
        'is_truncated': is_truncated,
        'line_count': len(lines),
        'size_kb': len(content) / 1024,
        'timestamp': datetime.now().isoformat()
    }


# AI Analysis
def analyze_with_ai(crash_data: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
    """Send crash to AI and get structured analysis."""

    if not config.get('api_key'):
        raise Exception("No API key found. Set OPENAI_API_KEY environment variable.")

    client = OpenAI(api_key=config['api_key'])

    prompt = f"""Analyze this VisualWorks Smalltalk crash log and provide a structured response.

CRASH LOG:
{crash_data['raw_content']}

Provide your analysis in this JSON format:
{{
  "error_type": "Brief error classification (e.g., MessageNotUnderstood, NullPointer, etc.)",
  "root_cause": "2-3 sentence explanation of what went wrong",
  "suggested_fixes": [
    "Fix 1 with specific code changes",
    "Fix 2 as alternative approach",
    "Fix 3 if needed"
  ],
  "severity": "critical|high|medium|low",
  "affected_component": "Which module/class is involved",
  "how_to_reproduce": "Steps to trigger this crash (if identifiable)",
  "confidence": "high|medium|low - how confident are you in this analysis"
}}

IMPORTANT: Return ONLY valid JSON, no markdown formatting or explanation."""

    try:
        response = client.chat.completions.create(
            model=config.get('model', 'gpt-4'),
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert Smalltalk developer analyzing crash logs. Always return valid JSON."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=config.get('temperature', 0.3),
            max_tokens=config.get('max_tokens', 2000)
        )

        ai_output = response.choices[0].message.content.strip()

        # Remove markdown code blocks if present
        if ai_output.startswith('```'):
            lines = ai_output.split('\n')
            # Remove first line (```json or ```) and last line (```)
            ai_output = '\n'.join(lines[1:-1])

        analysis = json.loads(ai_output)

        # Add usage metadata
        analysis['_metadata'] = {
            'model': config.get('model'),
            'tokens_used': response.usage.total_tokens,
            'cost_estimate': estimate_cost(response.usage.total_tokens, config.get('model'))
        }

        return analysis

    except json.JSONDecodeError as e:
        raise Exception(f"AI returned invalid JSON: {e}\nResponse: {ai_output}")
    except Exception as e:
        raise Exception(f"AI analysis failed: {e}")


def estimate_cost(tokens: int, model: str) -> float:
    """Estimate cost based on token usage."""
    # Pricing as of 2025 (approximate)
    pricing = {
        'gpt-4': 0.03 / 1000,  # $0.03 per 1k tokens (input)
        'gpt-4-turbo-preview': 0.01 / 1000,
        'gpt-3.5-turbo': 0.0015 / 1000
    }

    rate = pricing.get(model, 0.01 / 1000)
    return tokens * rate


# Save Results
def save_results(crash_data: Dict[str, Any], analysis: Dict[str, Any], output_dir: str = 'results') -> str:
    """Save analysis to JSON file."""
    Path(output_dir).mkdir(exist_ok=True)

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"{output_dir}/{Path(crash_data['filename']).stem}_{timestamp}.json"

    result = {
        'analyzed_at': datetime.now().isoformat(),
        'crash_file': crash_data['filename'],
        'analysis': analysis,
        'metadata': {
            'size_kb': crash_data['size_kb'],
            'line_count': crash_data['line_count']
        }
    }

    with open(filename, 'w') as f:
        json.dump(result, f, indent=2)

    return filename


# Pretty Print Results
def print_analysis(analysis: Dict[str, Any]):
    """Display analysis in terminal."""
    print("\n" + "="*60)
    print("🔍 CRASH ANALYSIS RESULTS")
    print("="*60)

    print(f"\n📌 Error Type: {analysis.get('error_type', 'Unknown')}")
    print(f"⚠️  Severity: {analysis.get('severity', 'unknown').upper()}")
    print(f"🎯 Component: {analysis.get('affected_component', 'Unknown')}")
    print(f"💡 Confidence: {analysis.get('confidence', 'unknown')}")

    print(f"\n🔎 Root Cause:")
    print(f"   {analysis.get('root_cause', 'Not provided')}")

    fixes = analysis.get('suggested_fixes', [])
    if fixes:
        print(f"\n✅ Suggested Fixes:")
        for i, fix in enumerate(fixes, 1):
            print(f"   {i}. {fix}")

    reproduce = analysis.get('how_to_reproduce')
    if reproduce:
        print(f"\n🔄 How to Reproduce:")
        print(f"   {reproduce}")

    # Show cost/usage if available
    if '_metadata' in analysis:
        meta = analysis['_metadata']
        print(f"\n💰 Analysis Cost:")
        print(f"   Model: {meta.get('model')}")
        print(f"   Tokens: {meta.get('tokens_used')}")
        print(f"   Cost: ${meta.get('cost_estimate', 0):.4f}")

    print("\n" + "="*60 + "\n")


# Main Execution
def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Smalltalk Crash Analyzer - Week 1 MVP")
        print("\nUsage: python analyze.py <crash-log-file>")
        print("\nExample:")
        print("  python analyze.py samples/my-crash.log")
        print("\nSetup:")
        print("  1. Install dependencies: pip install openai pyyaml")
        print("  2. Set API key: export OPENAI_API_KEY='your-key-here'")
        print("  3. Run analyzer on crash log")
        sys.exit(1)

    crash_file = sys.argv[1]

    if not Path(crash_file).exists():
        print(f"❌ Error: File not found: {crash_file}")
        sys.exit(1)

    print(f"📂 Reading crash log: {crash_file}")

    try:
        # Load config
        config = load_config()
        if not config.get('api_key'):
            print("⚠️  No API key found. Set OPENAI_API_KEY environment variable.")
            sys.exit(1)

        # Parse crash log
        max_size = config.get('max_file_size_kb', 400)
        crash_data = parse_crash_log(crash_file, max_size_kb=max_size)
        print(f"   Original Size: {crash_data['original_size_kb']:.2f} KB")
        print(f"   Lines: {crash_data['line_count']}")

        if crash_data['is_truncated']:
            print(f"   📏 Sent to AI: {crash_data['size_kb']:.2f} KB (truncated)")
            print(f"   💡 Keeping most relevant sections for analysis")

        # Analyze with AI
        print(f"\n🤖 Analyzing with {config['model']}...")
        analysis = analyze_with_ai(crash_data, config)

        # Display results
        print_analysis(analysis)

        # Save results
        output_file = save_results(crash_data, analysis)
        print(f"💾 Results saved to: {output_file}")
        print(f"\nNext steps:")
        print(f"  1. Review the analysis")
        print(f"  2. Try the suggested fixes")
        print(f"  3. Re-run if you need different perspective")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
