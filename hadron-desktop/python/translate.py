#!/usr/bin/env python3
"""
Technical Content Translator
Multi-Provider Support (OpenAI + Anthropic + Z.ai/GLM)

Usage: python translate.py "technical content to translate"
Environment Variables:
  AI_PROVIDER - Provider to use (openai|anthropic|zai, default: openai)
  AI_API_KEY - Your API key
  AI_MODEL - Model to use (default: gpt-4-turbo-preview)
"""

import sys
import json
import os
from typing import Dict, Any
import os
import requests

try:
    from openai import OpenAI
except ImportError:
    print(json.dumps({
        "error": "OpenAI package not installed. Please install it with: pip install openai"
    }), file=sys.stderr)
    sys.exit(1)

try:
    from anthropic import Anthropic
except ImportError:
    Anthropic = None


# Constants for AI messages
SYSTEM_MESSAGE = (
    "You are an expert technical analyst who explains code, errors, and technical content "
    "in detailed yet accessible language. You focus on what things DO, what they MEAN, "
    "and provide actionable insights."
)


def get_config() -> Dict[str, Any]:
    """Get configuration from environment variables."""
    provider = os.getenv('AI_PROVIDER', 'openai')
    api_key = os.getenv('AI_API_KEY')
    model = os.getenv('AI_MODEL', 'gpt-4-turbo-preview')

    if not api_key:
        raise ValueError(
            f"API key not configured for {provider}. Please add your API key in the Settings tab."
        )

    return {
        'provider': provider,
        'api_key': api_key,
        'model': model,
        'temperature': 0.3,
        'max_tokens': 3000  # Increased for detailed explanations with solutions
    }


def create_translation_prompt(content: str) -> str:
    """Create the translation prompt."""
    return f"""You are a technical translator that analyzes and explains code, errors, and technical content in plain language.

Analyze the following technical content and provide a comprehensive explanation that covers:

1. **What It Does**: Explain what this code/content actually does, step by step. Focus on the BEHAVIOR and ACTIONS, not just what type of code it is.

2. **What It Represents**: Describe the purpose and context. What problem is it solving? What is it trying to accomplish?

3. **Key Details**: Break down the important parts:
   - Explain any technical terms, functions, or concepts used
   - Describe the data flow or logic
   - Highlight critical operations or conditions
   - Identify any error messages, warnings, or issues

4. **For Errors/Issues**: If this appears to be an error, stack trace, or problem:
   - Explain what went wrong in simple terms
   - Describe the likely cause
   - Suggest 2-3 specific investigative actions to take
   - Recommend potential solutions or fixes

5. **Practical Context**: Use analogies or real-world comparisons when helpful to make it relatable.

Technical content to analyze:
{content}

Provide a clear, detailed explanation that helps someone understand not just WHAT this is, but what it DOES and what it MEANS:"""


def translate_with_openai(content: str, config: Dict[str, Any]) -> str:
    """Translate using OpenAI. Uses Responses API for GPT-5 / O-series models."""
    client = OpenAI(api_key=config['api_key'])

    def is_responses_model(mid: str) -> bool:
        m = (mid or "").lower()
        return m.startswith('gpt-5') or m.startswith('o3') or m.startswith('o1')

    try:
        if is_responses_model(config['model']):
            resp = client.responses.create(
                model=config['model'],
                input=[
                    {"role": "system", "content": SYSTEM_MESSAGE},
                    {"role": "user", "content": create_translation_prompt(content)}
                ],
                temperature=config['temperature'],
                max_output_tokens=config['max_tokens']
            )
            text = getattr(resp, 'output_text', None)
            if not text:
                try:
                    outputs = getattr(resp, 'output', [])
                    if outputs and hasattr(outputs[0], 'content') and outputs[0].content:
                        text = outputs[0].content[0].text
                except Exception:
                    pass
            if not text:
                raise Exception(
                    "Received empty response from OpenAI. This may indicate a temporary API issue. Please try again."
                )
            return text.strip()
        else:
            response = client.chat.completions.create(
                model=config['model'],
                messages=[
                    {"role": "system", "content": SYSTEM_MESSAGE},
                    {"role": "user", "content": create_translation_prompt(content)}
                ],
                temperature=config['temperature'],
                max_tokens=config['max_tokens']
            )
            return response.choices[0].message.content.strip()
    except Exception as e:
        error_msg = str(e).lower()
        if "authentication" in error_msg or "api key" in error_msg or "401" in error_msg:
            raise Exception(
                "Authentication failed. Please check your API key in Settings and ensure it's valid for OpenAI."
            )
        elif "rate limit" in error_msg or "429" in error_msg:
            raise Exception(
                "OpenAI rate limit exceeded. Please wait a moment and try again, or upgrade your API plan."
            )
        elif "timeout" in error_msg or "timed out" in error_msg:
            raise Exception(
                "Request timed out. OpenAI may be experiencing high load. Please try again in a moment."
            )
        elif "connection" in error_msg or "network" in error_msg:
            raise Exception(
                "Network error connecting to OpenAI. Please check your internet connection and try again."
            )
        else:
            raise Exception(f"OpenAI error: {str(e)}")


def translate_with_anthropic(content: str, config: Dict[str, Any]) -> str:
    """Translate using Anthropic."""
    if Anthropic is None:
        raise Exception(
            "Anthropic package not installed. Please install it with: pip install anthropic"
        )

    client = Anthropic(api_key=config['api_key'])

    try:
        response = client.messages.create(
            model=config['model'],
            max_tokens=config['max_tokens'],
            temperature=config['temperature'],
            system=SYSTEM_MESSAGE,
            messages=[
                {"role": "user", "content": create_translation_prompt(content)}
            ]
        )

        return response.content[0].text.strip()
    except Exception as e:
        error_msg = str(e).lower()
        if "authentication" in error_msg or "api key" in error_msg or "401" in error_msg:
            raise Exception(
                "Authentication failed. Please check your API key in Settings and ensure it's valid for Anthropic."
            )
        elif "rate limit" in error_msg or "429" in error_msg:
            raise Exception(
                "Anthropic rate limit exceeded. Please wait a moment and try again, or check your API plan limits."
            )
        elif "timeout" in error_msg or "timed out" in error_msg:
            raise Exception(
                "Request timed out. Anthropic may be experiencing high load. Please try again in a moment."
            )
        elif "connection" in error_msg or "network" in error_msg:
            raise Exception(
                "Network error connecting to Anthropic. Please check your internet connection and try again."
            )
        else:
            raise Exception(f"Anthropic error: {str(e)}")


def translate_with_zai(content: str, config: Dict[str, Any]) -> str:
    """Translate using Z.ai (GLM) - uses OpenAI-compatible API."""
    client = OpenAI(
        api_key=config['api_key'],
        base_url="https://open.bigmodel.cn/api/paas/v4/"
    )

    try:
        response = client.chat.completions.create(
            model=config['model'],
            messages=[
                {"role": "system", "content": SYSTEM_MESSAGE},
                {"role": "user", "content": create_translation_prompt(content)}
            ],
            temperature=config['temperature'],
            max_tokens=config['max_tokens']
        )

        return response.choices[0].message.content.strip()
    except Exception as e:
        error_msg = str(e).lower()
        if "authentication" in error_msg or "api key" in error_msg or "401" in error_msg:
            raise Exception(
                "Authentication failed. Please check your API key in Settings and ensure it's valid for Z.ai."
            )
        elif "rate limit" in error_msg or "429" in error_msg:
            raise Exception(
                "Z.ai rate limit exceeded. Please wait a moment and try again, or check your API plan limits."
            )
        elif "timeout" in error_msg or "timed out" in error_msg:
            raise Exception(
                "Request timed out. Z.ai may be experiencing high load. Please try again in a moment."
            )
        elif "connection" in error_msg or "network" in error_msg:
            raise Exception(
                "Network error connecting to Z.ai. Please check your internet connection and try again."
            )
        else:
            raise Exception(f"Z.ai error: {str(e)}")

def translate_with_ollama(content: str, config: Dict[str, Any]) -> str:
    base_url = os.getenv('OLLAMA_API_URL', 'http://127.0.0.1:11434')
    try:
        payload = {
            "model": config['model'],
            "messages": [
                {"role": "system", "content": SYSTEM_MESSAGE},
                {"role": "user", "content": create_translation_prompt(content)}
            ],
            "stream": False
        }
        r = requests.post(f"{base_url}/api/chat", json=payload, timeout=120)
        if r.status_code == 404:
            raise Exception(
                f"Model '{config['model']}' not found in Ollama. Please pull the model with: ollama pull {config['model']}"
            )
        elif r.status_code != 200:
            raise Exception(f"Ollama API error {r.status_code}: {r.text[:200]}")
        data = r.json()
        text = None
        if isinstance(data, dict):
            if 'message' in data and isinstance(data['message'], dict):
                text = data['message'].get('content')
            if not text:
                text = data.get('response')
        if not text:
            raise Exception(
                "Received empty response from Ollama. The model may not have generated any output. Please try again."
            )
        return text.strip()
    except requests.exceptions.ConnectionError:
        raise Exception(
            f"Cannot connect to Ollama at {base_url}. Please ensure Ollama is running and accessible."
        )
    except requests.exceptions.Timeout:
        raise Exception(
            "Request to Ollama timed out. The model may be too slow or the prompt too complex. Try a smaller model or simpler prompt."
        )
    except Exception as e:
        if "Ollama" in str(e):
            raise
        raise Exception(f"Ollama error: {str(e)}")

def translate_with_vllm(content: str, config: Dict[str, Any]) -> str:
    """Translate using vLLM - OpenAI-compatible local inference server."""
    base_url = os.getenv('VLLM_API_URL', 'http://127.0.0.1:8000')
    client = OpenAI(
        api_key='EMPTY',  # vLLM doesn't require API key
        base_url=f"{base_url}/v1"
    )

    try:
        response = client.chat.completions.create(
            model=config['model'],
            messages=[
                {"role": "system", "content": SYSTEM_MESSAGE},
                {"role": "user", "content": create_translation_prompt(content)}
            ],
            temperature=config['temperature'],
            max_tokens=config['max_tokens']
        )

        return response.choices[0].message.content.strip()
    except Exception as e:
        error_msg = str(e).lower()
        if "connection" in error_msg or "connect" in error_msg:
            raise Exception(
                f"Cannot connect to vLLM at {base_url}. Please ensure vLLM server is running."
            )
        elif "timeout" in error_msg or "timed out" in error_msg:
            raise Exception(
                "Request to vLLM timed out. The model may be too slow or overloaded. Try a smaller model."
            )
        elif "404" in error_msg or "not found" in error_msg:
            raise Exception(
                f"Model '{config['model']}' not found in vLLM. Check the model name and vLLM server configuration."
            )
        else:
            raise Exception(f"vLLM error: {str(e)}")

def translate_with_llamacpp(content: str, config: Dict[str, Any]) -> str:
    """Translate using llama.cpp - OpenAI-compatible local inference."""
    base_url = os.getenv('LLAMACPP_API_URL', 'http://127.0.0.1:8080')
    client = OpenAI(
        api_key='sk-no-key-required',  # llama.cpp doesn't require API key
        base_url=f"{base_url}/v1"
    )

    try:
        response = client.chat.completions.create(
            model=config.get('model', 'llama-model'),  # llama.cpp often uses generic name
            messages=[
                {"role": "system", "content": SYSTEM_MESSAGE},
                {"role": "user", "content": create_translation_prompt(content)}
            ],
            temperature=config['temperature'],
            max_tokens=config['max_tokens']
        )

        return response.choices[0].message.content.strip()
    except Exception as e:
        error_msg = str(e).lower()
        if "connection" in error_msg or "connect" in error_msg:
            raise Exception(
                f"Cannot connect to llama.cpp at {base_url}. Please ensure llama.cpp server is running with --host 127.0.0.1 --port 8080"
            )
        elif "timeout" in error_msg or "timed out" in error_msg:
            raise Exception(
                "Request to llama.cpp timed out. The model may be too slow for your hardware. Try reducing max_tokens or using a smaller model."
            )
        else:
            raise Exception(f"llama.cpp error: {str(e)}")


def translate_content(content: str) -> Dict[str, str]:
    """Main translation function."""
    try:
        config = get_config()
        provider = config['provider'].lower()

        if provider == 'anthropic':
            translation = translate_with_anthropic(content, config)
        elif provider == 'zai':
            translation = translate_with_zai(content, config)
        elif provider == 'ollama':
            translation = translate_with_ollama(content, config)
        elif provider == 'vllm':
            translation = translate_with_vllm(content, config)
        elif provider == 'llamacpp':
            translation = translate_with_llamacpp(content, config)
        else:  # default to openai
            translation = translate_with_openai(content, config)

        return {"translation": translation}

    except Exception as e:
        return {"error": str(e)}


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No content provided"}), file=sys.stderr)
        sys.exit(1)

    content = sys.argv[1]

    if not content.strip():
        print(json.dumps({"error": "Empty content provided"}), file=sys.stderr)
        sys.exit(1)

    result = translate_content(content)

    if "error" in result:
        print(json.dumps(result), file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result))


if __name__ == '__main__':
    main()
