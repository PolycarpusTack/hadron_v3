#!/usr/bin/env python3
"""
Hadron Model Training Script
QLoRA fine-tuning on gold analyses for local deployment

Usage:
    python -m training.train --config config.yaml
    python -m training.train --base-model meta-llama/Llama-3.1-8B-Instruct
"""

import os
import sys
import json
import argparse
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional

# Check for required libraries
try:
    import torch
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        TrainingArguments,
        Trainer,
        DataCollatorForLanguageModeling,
    )
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from datasets import load_dataset
    HAS_TRAINING_DEPS = True
except ImportError as e:
    HAS_TRAINING_DEPS = False
    IMPORT_ERROR = str(e)

from config import TrainingConfig, LoRAConfig, QuantizationConfig

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def check_dependencies():
    """Check if all required dependencies are available"""
    if not HAS_TRAINING_DEPS:
        logger.error(f"Missing training dependencies: {IMPORT_ERROR}")
        logger.info("Install with: pip install torch transformers peft bitsandbytes datasets accelerate")
        sys.exit(1)

    # Check CUDA availability
    if torch.cuda.is_available():
        logger.info(f"CUDA available: {torch.cuda.get_device_name(0)}")
        logger.info(f"CUDA memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    else:
        logger.warning("CUDA not available. Training will be very slow on CPU.")


def prepare_dataset(train_file: str, eval_file: str, tokenizer, max_length: int):
    """Load and prepare training dataset"""
    logger.info(f"Loading datasets from {train_file} and {eval_file}")

    def format_example(example):
        """Format JSONL example into training text"""
        messages = example.get("messages", [])
        text = ""
        for msg in messages:
            role = msg["role"]
            content = msg["content"]
            if role == "system":
                text += f"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{content}<|eot_id|>"
            elif role == "user":
                text += f"<|start_header_id|>user<|end_header_id|>\n\n{content}<|eot_id|>"
            elif role == "assistant":
                text += f"<|start_header_id|>assistant<|end_header_id|>\n\n{content}<|eot_id|>"
        return {"text": text}

    def tokenize(example):
        """Tokenize the formatted text"""
        result = tokenizer(
            example["text"],
            truncation=True,
            max_length=max_length,
            padding="max_length",
        )
        result["labels"] = result["input_ids"].copy()
        return result

    # Load datasets
    data_files = {}
    if Path(train_file).exists():
        data_files["train"] = train_file
    if Path(eval_file).exists():
        data_files["test"] = eval_file

    if not data_files:
        raise FileNotFoundError(f"No training data found at {train_file} or {eval_file}")

    dataset = load_dataset("json", data_files=data_files)

    # Format and tokenize
    dataset = dataset.map(format_example)
    dataset = dataset.map(tokenize, remove_columns=dataset["train"].column_names)

    logger.info(f"Train samples: {len(dataset['train'])}")
    if "test" in dataset:
        logger.info(f"Eval samples: {len(dataset['test'])}")

    return dataset


def create_model(
    base_model: str,
    quant_config: QuantizationConfig,
    lora_config: LoRAConfig,
):
    """Create and configure model with QLoRA"""
    logger.info(f"Loading base model: {base_model}")

    # BitsAndBytes quantization config
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=quant_config.load_in_4bit,
        bnb_4bit_quant_type=quant_config.bnb_4bit_quant_type,
        bnb_4bit_compute_dtype=getattr(torch, quant_config.bnb_4bit_compute_dtype),
        bnb_4bit_use_double_quant=quant_config.bnb_4bit_use_double_quant,
    )

    # Load model
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
    )

    # Prepare for k-bit training
    model = prepare_model_for_kbit_training(model)

    # Configure LoRA
    peft_config = LoraConfig(
        r=lora_config.r,
        lora_alpha=lora_config.lora_alpha,
        target_modules=lora_config.target_modules,
        lora_dropout=lora_config.lora_dropout,
        bias=lora_config.bias,
        task_type=lora_config.task_type,
    )

    # Apply LoRA
    model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()

    return model


def train(
    train_config: TrainingConfig,
    lora_config: LoRAConfig,
    quant_config: QuantizationConfig,
    resume_from: Optional[str] = None,
):
    """Run QLoRA fine-tuning"""
    check_dependencies()

    # Create output directory
    output_dir = Path(train_config.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Save config
    config_path = output_dir / "training_config.json"
    with open(config_path, "w") as f:
        json.dump({
            "training": train_config.__dict__,
            "lora": lora_config.__dict__,
            "quantization": quant_config.__dict__,
            "timestamp": datetime.now().isoformat(),
        }, f, indent=2)

    # Load tokenizer
    logger.info("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(train_config.base_model)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    # Prepare dataset
    dataset = prepare_dataset(
        train_config.train_file,
        train_config.eval_file,
        tokenizer,
        train_config.max_seq_length,
    )

    # Create model
    model = create_model(train_config.base_model, quant_config, lora_config)

    # Training arguments
    training_args = TrainingArguments(
        output_dir=str(output_dir),
        num_train_epochs=train_config.num_train_epochs,
        per_device_train_batch_size=train_config.per_device_train_batch_size,
        per_device_eval_batch_size=train_config.per_device_eval_batch_size,
        gradient_accumulation_steps=train_config.gradient_accumulation_steps,
        learning_rate=train_config.learning_rate,
        weight_decay=train_config.weight_decay,
        warmup_ratio=train_config.warmup_ratio,
        lr_scheduler_type=train_config.lr_scheduler_type,
        optim=train_config.optim,
        fp16=train_config.fp16,
        bf16=train_config.bf16,
        gradient_checkpointing=train_config.gradient_checkpointing,
        max_grad_norm=train_config.max_grad_norm,
        logging_steps=train_config.logging_steps,
        save_steps=train_config.save_steps,
        eval_strategy="steps" if "test" in dataset else "no",
        eval_steps=train_config.eval_steps if "test" in dataset else None,
        save_total_limit=train_config.save_total_limit,
        seed=train_config.seed,
        report_to=train_config.report_to,
        remove_unused_columns=False,
    )

    # Data collator
    data_collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)

    # Create trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=dataset["train"],
        eval_dataset=dataset.get("test"),
        data_collator=data_collator,
    )

    # Resume from checkpoint if specified
    if resume_from:
        logger.info(f"Resuming from checkpoint: {resume_from}")
        trainer.train(resume_from_checkpoint=resume_from)
    else:
        trainer.train()

    # Save final model
    final_path = output_dir / "final"
    logger.info(f"Saving final model to {final_path}")
    trainer.save_model(str(final_path))
    tokenizer.save_pretrained(str(final_path))

    logger.info("Training complete!")
    return str(final_path)


def main():
    parser = argparse.ArgumentParser(description="Hadron QLoRA Fine-tuning")
    parser.add_argument("--config", type=Path, help="Path to YAML config file")
    parser.add_argument("--base-model", default="meta-llama/Llama-3.1-8B-Instruct",
                       help="Base model to fine-tune")
    parser.add_argument("--train-file", default="data/hadron_train.jsonl",
                       help="Training data JSONL file")
    parser.add_argument("--eval-file", default="data/hadron_test.jsonl",
                       help="Evaluation data JSONL file")
    parser.add_argument("--output-dir", default="outputs/hadron-v1",
                       help="Output directory")
    parser.add_argument("--epochs", type=int, default=3, help="Number of epochs")
    parser.add_argument("--batch-size", type=int, default=4, help="Batch size")
    parser.add_argument("--learning-rate", type=float, default=2e-4, help="Learning rate")
    parser.add_argument("--lora-r", type=int, default=16, help="LoRA rank")
    parser.add_argument("--resume-from", type=str, help="Resume from checkpoint")

    args = parser.parse_args()

    # Load or create configs
    train_config = TrainingConfig(
        base_model=args.base_model,
        train_file=args.train_file,
        eval_file=args.eval_file,
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        learning_rate=args.learning_rate,
    )

    lora_config = LoRAConfig(r=args.lora_r)
    quant_config = QuantizationConfig()

    train(train_config, lora_config, quant_config, resume_from=args.resume_from)


if __name__ == "__main__":
    main()
