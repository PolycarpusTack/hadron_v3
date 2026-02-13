#!/usr/bin/env python3
"""
Smalltalk Crash Analyzer - JSON Output Version
Multi-Provider Support (OpenAI + Anthropic + Z.ai/GLM)

Usage: python analyze_json.py crash-log.txt
Environment Variables:
  AI_PROVIDER - Provider to use (openai|anthropic|zai, default: openai)
  AI_API_KEY - Your API key
  AI_MODEL - Model to use (default: gpt-4-turbo-preview)
  PROMPT_VERSION - Prompt template version (default: v2)
"""

import sys
import json
import yaml
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional
import requests

# Import logging configuration
try:
    from logger_config import logger, log_analysis_start, log_analysis_complete, log_analysis_error
    LOGGING_ENABLED = True
except ImportError:
    # Fallback if logger not available
    import logging
    logger = logging.getLogger(__name__)
    LOGGING_ENABLED = False

try:
    from openai import OpenAI
except ImportError:
    print(json.dumps({"error": "OpenAI package not installed"}), file=sys.stderr)
    sys.exit(1)

try:
    from anthropic import Anthropic
except ImportError:
    # Anthropic is optional
    Anthropic = None

# Import prompt templates
try:
    from prompts import crash_analysis_v2, crash_analysis_complete, crash_analysis_specialized
    PROMPTS_AVAILABLE = True
except ImportError:
    PROMPTS_AVAILABLE = False
    print("Warning: Prompt templates not found, using inline prompts", file=sys.stderr)


def load_config() -> Dict[str, Any]:
    """Load config from config.yaml or use defaults with multi-provider support."""
    config_file = Path(__file__).parent / 'config.yaml'

    if config_file.exists():
        with open(config_file, 'r') as f:
            config = yaml.safe_load(f)
    else:
        config = {
            'provider': 'openai',
            'model': 'gpt-4-turbo-preview',
            'temperature': 0.3,
            'max_tokens': 2000
        }

    # Get provider from environment variable
    provider = os.getenv('AI_PROVIDER', config.get('provider', 'openai'))

    # Get API key from environment variable
    api_key = os.getenv('AI_API_KEY', os.getenv('OPENAI_API_KEY'))  # Fallback for backward compatibility

    # Get model from environment, with provider-specific defaults
    default_model = 'glm-4.6' if provider == 'zai' else 'gpt-4-turbo-preview'
    model = os.getenv('AI_MODEL', config.get('model', default_model))

    config['provider'] = provider
    config['api_key'] = api_key
    config['model'] = model

    return config


def parse_crash_log(file_path: str, max_size_kb: int = 400) -> Dict[str, Any]:
    """Read and extract basic info from crash log with smart truncation."""
    try:
        file_size = Path(file_path).stat().st_size
        size_kb = file_size / 1024

        content = Path(file_path).read_text(encoding='utf-8', errors='ignore')
        is_truncated = False

        # Smart truncation for large files
        if size_kb > max_size_kb:
            is_truncated = True
            max_bytes = max_size_kb * 1024
            keep_start = int(max_bytes * 0.5)
            keep_end = int(max_bytes * 0.25)

            start_content = content[:keep_start]
            end_content = content[-keep_end:]

            truncation_notice = f"\n\n{'='*60}\n"
            truncation_notice += f"[TRUNCATED: Original file was {size_kb:.1f} KB]\n"
            truncation_notice += f"[Showing: First {keep_start/1024:.1f} KB + Last {keep_end/1024:.1f} KB]\n"
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


def get_prompts(crash_data: Dict[str, Any], config: Dict[str, Any], analysis_type: str = "complete") -> Dict[str, str]:
    """Get prompts from template system based on analysis type or fallback to inline."""
    if PROMPTS_AVAILABLE:
        context = {
            'was_truncated': crash_data.get('is_truncated', False),
            'original_size_kb': crash_data.get('original_size_kb', 0)
        }

        # Select the appropriate prompt module based on analysis type
        if analysis_type == "specialized":
            prompt_data = crash_analysis_specialized.get_prompt(crash_data['raw_content'], context)
            print(f"Using SPECIALIZED analysis - prompt version: {prompt_data['version']}", file=sys.stderr)
        elif analysis_type == "complete":
            prompt_data = crash_analysis_complete.get_prompt(crash_data['raw_content'], context)
            print(f"Using COMPLETE analysis - prompt version: {prompt_data['version']}", file=sys.stderr)
        else:
            # Fallback to v2 if unknown type
            prompt_data = crash_analysis_v2.get_prompt(crash_data['raw_content'], context)
            print(f"Using fallback v2 analysis - prompt version: {prompt_data['version']}", file=sys.stderr)

        return prompt_data
    else:
        # Fallback to inline v1 prompt
        return {
            'system': "You are an expert Smalltalk developer analyzing crash logs. Always return valid JSON.",
            'user': f"""Analyze this VisualWorks Smalltalk crash log:

{crash_data['raw_content']}

Return JSON with: error_type, root_cause, suggested_fixes, severity, affected_component, confidence.
ONLY valid JSON, no markdown.""",
            'version': '1.0'
        }


def analyze_with_ai(crash_data: Dict[str, Any], config: Dict[str, Any], analysis_type: str = "complete") -> Dict[str, Any]:
    """Send crash to AI and get structured analysis using selected provider."""

    # Get provider and model from config first
    provider = config.get('provider', 'openai')
    model = config.get('model', 'gpt-4-turbo-preview')

    # Validate API key (not needed for llamacpp)
    if provider != 'llamacpp' and not config.get('api_key'):
        raise Exception("No API key found. Set AI_API_KEY environment variable.")

    # Get prompts from template system with analysis type
    prompts = get_prompts(crash_data, config, analysis_type)

    try:
        # Helper: detect OpenAI Responses API models (e.g., gpt-5.*, o3, o1)
        def is_openai_responses_model(mid: str) -> bool:
            m = (mid or "").lower()
            return m.startswith('gpt-5') or m.startswith('o3') or m.startswith('o1')

        # Provider-specific clients
        if provider == 'anthropic':
            if not Anthropic:
                raise Exception("Anthropic package not installed. Run: pip install anthropic")

            client = Anthropic(api_key=config['api_key'])

            response = client.messages.create(
                model=model,
                max_tokens=config.get('max_tokens', 4000),
                temperature=config.get('temperature', 0.3),
                system=prompts['system'],
                messages=[{
                    "role": "user",
                    "content": prompts['user']
                }]
            )

            ai_output = response.content[0].text.strip()
            tokens_used = response.usage.input_tokens + response.usage.output_tokens

        elif provider == 'zai':
            # Z.ai uses OpenAI-compatible API
            client = OpenAI(
                api_key=config['api_key'],
                base_url="https://api.z.ai/api/paas/v4"
            )

            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": prompts['system']},
                    {"role": "user", "content": prompts['user']}
                ],
                temperature=config.get('temperature', 0.3),
                max_tokens=config.get('max_tokens', 2000)
            )

            ai_output = response.choices[0].message.content.strip()
            tokens_used = response.usage.total_tokens

        elif provider == 'llamacpp':
            # Local llama.cpp via OpenAI-compatible API
            base_url = os.getenv('LLAMACPP_API_URL', 'http://127.0.0.1:8080')
            try:
                client = OpenAI(api_key="no-key", base_url=f"{base_url}/v1")
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": prompts['system']},
                        {"role": "user", "content": prompts['user']}
                    ],
                    temperature=config.get('temperature', 0.3),
                    max_tokens=config.get('max_tokens', 2000)
                )
                ai_output = response.choices[0].message.content.strip()
                tokens_used = 0  # llama.cpp local; no billing
            except Exception as e:
                raise Exception(f"llama.cpp request failed: {e}")

        else:  # openai (default)
            client = OpenAI(api_key=config['api_key'])

            if is_openai_responses_model(model):
                # Use Responses API for GPT-5 / O-series
                try:
                    response = client.responses.create(
                        model=model,
                        input=[
                            {"role": "system", "content": prompts['system']},
                            {"role": "user", "content": prompts['user']}
                        ],
                        temperature=config.get('temperature', 0.3),
                        max_output_tokens=config.get('max_tokens', 2000)
                    )
                    # New SDK convenience accessor
                    ai_output = getattr(response, 'output_text', None)
                    if not ai_output:
                        # Fallback: join first text segment if structure present
                        try:
                            outputs = getattr(response, 'output', [])
                            if outputs and hasattr(outputs[0], 'content') and outputs[0].content:
                                ai_output = outputs[0].content[0].text
                        except Exception:
                            pass
                    if not ai_output:
                        raise Exception("Empty response from Responses API")

                    # Token usage accounting
                    tokens_used = 0
                    usage = getattr(response, 'usage', None)
                    if usage is not None:
                        tokens_used = getattr(usage, 'total_tokens', 0) or (
                            (getattr(usage, 'input_tokens', 0) or getattr(usage, 'prompt_tokens', 0)) +
                            (getattr(usage, 'output_tokens', 0) or getattr(usage, 'completion_tokens', 0))
                        )
                except Exception as e:
                    # As a safety net, fall back to chat.completions for compatible models
                    raise
            else:
                # Chat Completions API for GPT-4.x / 3.5
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": prompts['system']},
                        {"role": "user", "content": prompts['user']}
                    ],
                    temperature=config.get('temperature', 0.3),
                    max_tokens=config.get('max_tokens', 2000)
                )

                ai_output = response.choices[0].message.content.strip()
                tokens_used = response.usage.total_tokens

        # Remove markdown code blocks if present
        if ai_output.startswith('```'):
            lines = ai_output.split('\n')
            ai_output = '\n'.join(lines[1:-1])

        analysis = json.loads(ai_output)

        # Add metadata
        analysis['tokens_used'] = tokens_used
        analysis['cost'] = estimate_cost(tokens_used, model, provider)
        analysis['provider'] = provider
        analysis['prompt_version'] = prompts.get('version', '1.0')

        return analysis

    except json.JSONDecodeError as e:
        raise Exception(f"AI returned invalid JSON: {e}\nResponse: {ai_output}")
    except Exception as e:
        raise Exception(f"AI analysis failed: {e}")


def estimate_cost(tokens: int, model: str, provider: str = 'openai') -> float:
    """Estimate cost based on token usage and provider.

    Args:
        tokens: Total tokens used (input + output)
        model: Model identifier
        provider: AI provider (openai, anthropic, zai)

    Returns:
        Estimated cost in USD
    """
    pricing = {
        # OpenAI
        'gpt-4': 0.03 / 1000,
        'gpt-4-turbo-preview': 0.01 / 1000,
        'gpt-3.5-turbo': 0.0015 / 1000,

        # Anthropic (averaged input/output for simplicity)
        # Claude 3.5 Sonnet: $3 input, $15 output per M tokens
        'claude-3-5-sonnet-20241022': 0.009 / 1000,  # avg of $3/$15
        # Claude 3 Opus: $15 input, $75 output per M tokens
        'claude-3-opus-20240229': 0.045 / 1000,
        # Claude 3 Haiku: $0.25 input, $1.25 output per M tokens
        'claude-3-haiku-20240307': 0.000875 / 1000,

        # Z.ai (flat $3/month subscription, amortized estimate)
        # Assuming ~200K tokens/month usage = $0.015 per 1K tokens
        'glm-4.6': 0.000015 / 1000,  # effectively free with subscription

        # llama.cpp - local, effectively zero cost
        'llamacpp': 0.0,
    }

    if provider == 'llamacpp':
        return 0.0

    rate = pricing.get(model, 0.01 / 1000)
    return tokens * rate


def main():
    """Main entry point - outputs JSON only."""
    if len(sys.argv) < 2:
        print(json.dumps({
            "error": "Missing crash log file path",
            "usage": "python analyze_json.py <crash-log-file> [analysis_type]"
        }), file=sys.stderr)
        sys.exit(1)

    crash_file = sys.argv[1]

    # Get analysis type from command line or environment variable (default: "complete")
    analysis_type = sys.argv[2] if len(sys.argv) > 2 else os.getenv('ANALYSIS_TYPE', 'complete')

    if not Path(crash_file).exists():
        print(json.dumps({
            "error": f"File not found: {crash_file}"
        }), file=sys.stderr)
        sys.exit(1)

    try:
        # Load config
        config = load_config()
        if not config.get('api_key'):
            print(json.dumps({
                "error": "No API key found. Set OPENAI_API_KEY environment variable."
            }), file=sys.stderr)
            sys.exit(1)

        # Log analysis start
        start_time = time.time()
        if LOGGING_ENABLED:
            log_analysis_start(crash_file, config.get('provider', 'openai'), config.get('model'))

        # Parse crash log
        max_size = config.get('max_file_size_kb', 400)
        crash_data = parse_crash_log(crash_file, max_size_kb=max_size)

        # Analyze with AI using the specified analysis type
        analysis = analyze_with_ai(crash_data, config, analysis_type)

        # Calculate duration
        duration_ms = int((time.time() - start_time) * 1000)

        # Add file metadata to response
        result = {
            **analysis,
            'filename': crash_data['filename'],
            'file_size_kb': crash_data['original_size_kb'],
            'was_truncated': crash_data['is_truncated'],
            'ai_model': config['model']
        }

        # Log successful completion
        if LOGGING_ENABLED:
            log_analysis_complete(
                crash_file,
                config.get('provider', 'openai'),
                analysis.get('cost', 0.0),
                analysis.get('tokens_used', 0),
                duration_ms
            )

        # Output pure JSON to stdout
        print(json.dumps(result))

    except Exception as e:
        # Log error
        if LOGGING_ENABLED:
            log_analysis_error(crash_file, config.get('provider', 'openai'), str(e))

        print(json.dumps({
            "error": str(e)
        }), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
