"""
Training Configuration
QLoRA fine-tuning settings for local model training
"""

from dataclasses import dataclass, field
from typing import Optional, List
from pathlib import Path


@dataclass
class LoRAConfig:
    """LoRA (Low-Rank Adaptation) configuration"""
    r: int = 16  # Rank
    lora_alpha: int = 32  # Alpha scaling
    target_modules: List[str] = field(default_factory=lambda: [
        "q_proj", "v_proj", "k_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj"
    ])
    lora_dropout: float = 0.05
    bias: str = "none"
    task_type: str = "CAUSAL_LM"


@dataclass
class QuantizationConfig:
    """4-bit quantization settings"""
    load_in_4bit: bool = True
    bnb_4bit_quant_type: str = "nf4"
    bnb_4bit_compute_dtype: str = "bfloat16"
    bnb_4bit_use_double_quant: bool = True


@dataclass
class TrainingConfig:
    """Training hyperparameters"""
    # Model
    base_model: str = "meta-llama/Llama-3.1-8B-Instruct"
    model_revision: str = "main"

    # Data
    train_file: str = "data/hadron_train.jsonl"
    eval_file: str = "data/hadron_test.jsonl"
    max_seq_length: int = 2048
    dataset_text_field: str = "text"

    # Training
    num_train_epochs: int = 3
    per_device_train_batch_size: int = 4
    per_device_eval_batch_size: int = 4
    gradient_accumulation_steps: int = 4
    learning_rate: float = 2e-4
    weight_decay: float = 0.01
    warmup_ratio: float = 0.03
    lr_scheduler_type: str = "cosine"

    # Optimization
    optim: str = "paged_adamw_32bit"
    fp16: bool = False
    bf16: bool = True
    gradient_checkpointing: bool = True
    max_grad_norm: float = 0.3

    # Logging & Saving
    output_dir: str = "outputs/hadron-v1"
    logging_steps: int = 10
    save_steps: int = 100
    eval_steps: int = 100
    save_total_limit: int = 3

    # Misc
    seed: int = 42
    report_to: str = "tensorboard"


@dataclass
class LlamaCppConfig:
    """llama.cpp model packaging configuration"""
    model_name: str = "hadron"
    model_version: str = "v1"
    quantization: str = "q4_k_m"  # q4_0, q4_k_m, q5_0, q5_k_m, q8_0
    system_prompt: str = """You are a WHATS'ON broadcast management system crash analysis expert.
Analyze Smalltalk crash logs and provide:
1. Root cause identification with specific class/method references
2. Severity assessment (critical/high/medium/low)
3. Actionable fix suggestions specific to WHATS'ON
4. Component classification (EPG, Rights, Scheduling, etc.)

Return your analysis as structured JSON."""

    parameters: dict = field(default_factory=lambda: {
        "temperature": 0.3,
        "top_p": 0.9,
        "top_k": 40,
        "n_ctx": 4096,
        "n_predict": 2048,
        "stop": ["<|eot_id|>", "<|end_of_text|>"]
    })


def get_default_config() -> dict:
    """Get default training configuration as dict"""
    return {
        "lora": LoRAConfig().__dict__,
        "quantization": QuantizationConfig().__dict__,
        "training": TrainingConfig().__dict__,
        "llamacpp": {
            "model_name": LlamaCppConfig.model_name,
            "model_version": LlamaCppConfig.model_version,
            "quantization": LlamaCppConfig.quantization,
        }
    }


def load_config(config_path: Optional[Path] = None) -> dict:
    """Load configuration from YAML file or return defaults"""
    if config_path and config_path.exists():
        import yaml
        with open(config_path) as f:
            return yaml.safe_load(f)
    return get_default_config()
