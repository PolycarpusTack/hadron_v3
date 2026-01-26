#!/usr/bin/env python3
"""
Ollama Model Packaging Script
Converts fine-tuned model to Ollama format for local deployment

Usage:
    python -m training.package_ollama --model-path outputs/hadron-v1/final
    python -m training.package_ollama --model-path outputs/hadron-v1/final --quantization q4_k_m
"""

import os
import sys
import json
import shutil
import argparse
import subprocess
import tempfile
import logging
from pathlib import Path
from typing import Optional

from config import OllamaConfig

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def check_ollama_installed() -> bool:
    """Check if Ollama is installed"""
    try:
        result = subprocess.run(["ollama", "version"], capture_output=True, text=True)
        logger.info(f"Ollama version: {result.stdout.strip()}")
        return True
    except FileNotFoundError:
        return False


def check_llama_cpp() -> bool:
    """Check if llama.cpp conversion tools are available"""
    try:
        # Check for quantize binary
        result = subprocess.run(["which", "quantize"], capture_output=True, text=True)
        return result.returncode == 0
    except:
        return False


def merge_lora_weights(
    base_model: str,
    lora_path: Path,
    output_path: Path,
) -> Path:
    """Merge LoRA weights with base model"""
    logger.info(f"Merging LoRA weights from {lora_path}")

    try:
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer
        import torch

        # Load base model
        logger.info(f"Loading base model: {base_model}")
        base = AutoModelForCausalLM.from_pretrained(
            base_model,
            torch_dtype=torch.float16,
            device_map="auto",
        )

        # Load LoRA
        logger.info("Loading LoRA adapter...")
        model = PeftModel.from_pretrained(base, str(lora_path))

        # Merge weights
        logger.info("Merging weights...")
        merged = model.merge_and_unload()

        # Save merged model
        output_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Saving merged model to {output_path}")
        merged.save_pretrained(str(output_path))

        # Save tokenizer
        tokenizer = AutoTokenizer.from_pretrained(base_model)
        tokenizer.save_pretrained(str(output_path))

        return output_path

    except ImportError as e:
        logger.error(f"Missing dependencies for merging: {e}")
        logger.info("Install with: pip install peft transformers torch")
        sys.exit(1)


def convert_to_gguf(
    model_path: Path,
    output_path: Path,
    quantization: str = "q4_k_m",
) -> Path:
    """Convert model to GGUF format using llama.cpp"""
    logger.info(f"Converting to GGUF with {quantization} quantization")

    # Check for conversion script
    convert_script = Path("llama.cpp/convert-hf-to-gguf.py")
    if not convert_script.exists():
        # Try to find it in PATH or common locations
        for path in [
            Path.home() / "llama.cpp/convert-hf-to-gguf.py",
            Path("/opt/llama.cpp/convert-hf-to-gguf.py"),
        ]:
            if path.exists():
                convert_script = path
                break

    if not convert_script.exists():
        logger.error("llama.cpp conversion script not found")
        logger.info("Clone llama.cpp: git clone https://github.com/ggerganov/llama.cpp")
        logger.info("Then run: pip install -r llama.cpp/requirements.txt")
        sys.exit(1)

    # Output file
    gguf_file = output_path / f"hadron-{quantization}.gguf"

    # First convert to f16 GGUF
    logger.info("Converting to f16 GGUF...")
    f16_file = output_path / "hadron-f16.gguf"

    cmd = [
        sys.executable, str(convert_script),
        str(model_path),
        "--outfile", str(f16_file),
        "--outtype", "f16",
    ]
    subprocess.run(cmd, check=True)

    # Then quantize
    if quantization != "f16":
        logger.info(f"Quantizing to {quantization}...")
        quantize_bin = shutil.which("quantize") or shutil.which("llama-quantize")

        if not quantize_bin:
            # Try common locations
            for path in [
                Path.home() / "llama.cpp/build/bin/quantize",
                Path.home() / "llama.cpp/quantize",
                Path("/opt/llama.cpp/build/bin/quantize"),
            ]:
                if path.exists():
                    quantize_bin = str(path)
                    break

        if not quantize_bin:
            logger.error("quantize binary not found")
            logger.info("Build llama.cpp: cd llama.cpp && make")
            return f16_file

        cmd = [quantize_bin, str(f16_file), str(gguf_file), quantization]
        subprocess.run(cmd, check=True)

        # Remove f16 file
        f16_file.unlink()
        return gguf_file

    return f16_file


def create_modelfile(
    gguf_path: Path,
    config: OllamaConfig,
    output_path: Path,
) -> Path:
    """Create Ollama Modelfile"""
    modelfile_path = output_path / "Modelfile"

    content = f'''# Hadron WHATS'ON Crash Analysis Model
# Generated by Hadron training pipeline

FROM {gguf_path}

# System prompt
SYSTEM """{config.system_prompt}"""

# Chat template
TEMPLATE """{config.template}"""

# Parameters
'''
    for key, value in config.parameters.items():
        if isinstance(value, list):
            for v in value:
                content += f'PARAMETER {key} "{v}"\n'
        else:
            content += f"PARAMETER {key} {value}\n"

    with open(modelfile_path, "w") as f:
        f.write(content)

    logger.info(f"Created Modelfile at {modelfile_path}")
    return modelfile_path


def create_ollama_model(
    modelfile_path: Path,
    model_name: str,
) -> bool:
    """Create Ollama model from Modelfile"""
    logger.info(f"Creating Ollama model: {model_name}")

    cmd = ["ollama", "create", model_name, "-f", str(modelfile_path)]

    try:
        subprocess.run(cmd, check=True)
        logger.info(f"Successfully created Ollama model: {model_name}")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to create Ollama model: {e}")
        return False


def package_model(
    model_path: Path,
    output_dir: Path,
    config: OllamaConfig,
    base_model: Optional[str] = None,
    skip_merge: bool = False,
) -> bool:
    """Full pipeline to package model for Ollama"""

    output_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: Merge LoRA weights if needed
    if not skip_merge and (model_path / "adapter_config.json").exists():
        if not base_model:
            # Try to read from adapter config
            adapter_config = json.load(open(model_path / "adapter_config.json"))
            base_model = adapter_config.get("base_model_name_or_path")

        if not base_model:
            logger.error("Base model not specified and not found in adapter config")
            return False

        merged_path = output_dir / "merged"
        merge_lora_weights(base_model, model_path, merged_path)
        model_path = merged_path

    # Step 2: Convert to GGUF
    gguf_path = convert_to_gguf(model_path, output_dir, config.quantization)

    # Step 3: Create Modelfile
    modelfile_path = create_modelfile(gguf_path, config, output_dir)

    # Step 4: Create Ollama model (if Ollama is available)
    model_name = f"{config.model_name}:{config.model_version}"
    if check_ollama_installed():
        create_ollama_model(modelfile_path, model_name)
    else:
        logger.warning("Ollama not installed. Modelfile created for manual import.")
        logger.info(f"To import manually: ollama create {model_name} -f {modelfile_path}")

    logger.info("Packaging complete!")
    logger.info(f"  GGUF file: {gguf_path}")
    logger.info(f"  Modelfile: {modelfile_path}")
    logger.info(f"  Model name: {model_name}")

    return True


def main():
    parser = argparse.ArgumentParser(description="Package fine-tuned model for Ollama")
    parser.add_argument("--model-path", type=Path, required=True,
                       help="Path to fine-tuned model (LoRA or merged)")
    parser.add_argument("--output-dir", type=Path, default=Path("ollama_package"),
                       help="Output directory")
    parser.add_argument("--base-model", type=str,
                       help="Base model (for LoRA merging)")
    parser.add_argument("--quantization", default="q4_k_m",
                       choices=["q4_0", "q4_k_m", "q5_0", "q5_k_m", "q8_0", "f16"],
                       help="Quantization type")
    parser.add_argument("--model-name", default="hadron",
                       help="Ollama model name")
    parser.add_argument("--model-version", default="v1",
                       help="Ollama model version")
    parser.add_argument("--skip-merge", action="store_true",
                       help="Skip LoRA merging (model is already merged)")

    args = parser.parse_args()

    config = OllamaConfig()
    config.quantization = args.quantization
    config.model_name = args.model_name
    config.model_version = args.model_version

    package_model(
        args.model_path,
        args.output_dir,
        config,
        base_model=args.base_model,
        skip_merge=args.skip_merge,
    )


if __name__ == "__main__":
    main()
