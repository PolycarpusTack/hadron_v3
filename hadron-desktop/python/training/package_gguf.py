#!/usr/bin/env python3
"""
GGUF Model Packaging Script
Converts fine-tuned model to GGUF format for llama.cpp (llama-server) deployment

Usage:
    python -m training.package_gguf --model-path outputs/hadron-v1/final
    python -m training.package_gguf --model-path outputs/hadron-v1/final --quantization q4_k_m
"""

import os
import sys
import json
import shutil
import argparse
import subprocess
import logging
from pathlib import Path
from typing import Optional

from config import LlamaCppConfig

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def check_llama_cpp() -> bool:
    """Check if llama.cpp conversion tools are available"""
    try:
        result = subprocess.run(["which", "llama-quantize"], capture_output=True, text=True)
        if result.returncode == 0:
            return True
        result = subprocess.run(["which", "quantize"], capture_output=True, text=True)
        return result.returncode == 0
    except Exception:
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
        quantize_bin = shutil.which("llama-quantize") or shutil.which("quantize")

        if not quantize_bin:
            # Try common locations
            for path in [
                Path.home() / "llama.cpp/build/bin/llama-quantize",
                Path.home() / "llama.cpp/build/bin/quantize",
                Path("/opt/llama.cpp/build/bin/llama-quantize"),
            ]:
                if path.exists():
                    quantize_bin = str(path)
                    break

        if not quantize_bin:
            logger.error("llama-quantize binary not found")
            logger.info("Build llama.cpp: cd llama.cpp && cmake -B build && cmake --build build")
            return f16_file

        cmd = [quantize_bin, str(f16_file), str(gguf_file), quantization]
        subprocess.run(cmd, check=True)

        # Remove f16 file
        f16_file.unlink()
        return gguf_file

    return f16_file


def package_model(
    model_path: Path,
    output_dir: Path,
    config: LlamaCppConfig,
    base_model: Optional[str] = None,
    skip_merge: bool = False,
) -> bool:
    """Full pipeline to package model as GGUF for llama.cpp"""

    output_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: Merge LoRA weights if needed
    if not skip_merge and (model_path / "adapter_config.json").exists():
        if not base_model:
            # Try to read from adapter config
            with open(model_path / "adapter_config.json") as f:
                adapter_config = json.load(f)
            base_model = adapter_config.get("base_model_name_or_path")

        if not base_model:
            logger.error("Base model not specified and not found in adapter config")
            return False

        merged_path = output_dir / "merged"
        merge_lora_weights(base_model, model_path, merged_path)
        model_path = merged_path

    # Step 2: Convert to GGUF
    gguf_path = convert_to_gguf(model_path, output_dir, config.quantization)

    model_name = f"{config.model_name}:{config.model_version}"

    logger.info("Packaging complete!")
    logger.info(f"  GGUF file: {gguf_path}")
    logger.info(f"  Model name: {model_name}")
    logger.info(f"")
    logger.info(f"To serve with llama-server:")
    logger.info(f"  llama-server -m {gguf_path} --host 127.0.0.1 --port 8080")

    return True


def main():
    parser = argparse.ArgumentParser(description="Package fine-tuned model as GGUF for llama.cpp")
    parser.add_argument("--model-path", type=Path, required=True,
                       help="Path to fine-tuned model (LoRA or merged)")
    parser.add_argument("--output-dir", type=Path, default=Path("gguf_package"),
                       help="Output directory")
    parser.add_argument("--base-model", type=str,
                       help="Base model (for LoRA merging)")
    parser.add_argument("--quantization", default="q4_k_m",
                       choices=["q4_0", "q4_k_m", "q5_0", "q5_k_m", "q8_0", "f16"],
                       help="Quantization type")
    parser.add_argument("--model-name", default="hadron",
                       help="Model name")
    parser.add_argument("--model-version", default="v1",
                       help="Model version")
    parser.add_argument("--skip-merge", action="store_true",
                       help="Skip LoRA merging (model is already merged)")

    args = parser.parse_args()

    config = LlamaCppConfig()
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
