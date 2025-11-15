"""
Structured Logging Configuration for Hadron Python Backend
Alex Chen: "Logging is boring until production breaks at 3am"
"""

import logging
import logging.handlers
from pathlib import Path
import sys
import json
from datetime import datetime

# Log directory (same as Tauri log directory)
if sys.platform == 'win32':
    LOG_DIR = Path.home() / 'AppData' / 'Roaming' / 'com.hadron.dev' / 'logs'
elif sys.platform == 'darwin':
    LOG_DIR = Path.home() / 'Library' / 'Logs' / 'com.hadron.dev'
else:  # Linux
    LOG_DIR = Path.home() / '.local' / 'share' / 'com.hadron.dev' / 'logs'

LOG_DIR.mkdir(parents=True, exist_ok=True)


class JSONFormatter(logging.Formatter):
    """
    Format logs as JSON for easy parsing and analysis
    """

    def format(self, record):
        log_obj = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'module': record.module,
            'function': record.funcName,
            'line': record.lineno,
        }

        # Add exception info if present
        if record.exc_info:
            log_obj['exception'] = self.formatException(record.exc_info)

        # Add extra fields
        if hasattr(record, 'provider'):
            log_obj['provider'] = record.provider
        if hasattr(record, 'model'):
            log_obj['model'] = record.model
        if hasattr(record, 'cost'):
            log_obj['cost'] = record.cost
        if hasattr(record, 'tokens'):
            log_obj['tokens'] = record.tokens
        if hasattr(record, 'file_path'):
            log_obj['file_path'] = record.file_path

        return json.dumps(log_obj)


def setup_logger(name='hadron', level=logging.INFO):
    """
    Configure structured logging with rotation

    Creates two log files:
    - hadron.log - JSON formatted logs (for parsing)
    - hadron-human.log - Human readable logs (for debugging)

    Both with 10MB rotation, keeping 5 files
    """
    logger = logging.getLogger(name)
    logger.setLevel(level)

    # Remove existing handlers
    logger.handlers.clear()

    # Console handler (human-readable, only errors)
    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setLevel(logging.ERROR)
    console_formatter = logging.Formatter(
        '%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)

    # JSON file handler (all logs, machine-readable)
    json_file = LOG_DIR / 'hadron-python.log'
    json_handler = logging.handlers.RotatingFileHandler(
        json_file,
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5,
        encoding='utf-8'
    )
    json_handler.setLevel(logging.DEBUG)
    json_handler.setFormatter(JSONFormatter())
    logger.addHandler(json_handler)

    # Human-readable file handler (info and above)
    human_file = LOG_DIR / 'hadron-python-human.log'
    human_handler = logging.handlers.RotatingFileHandler(
        human_file,
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5,
        encoding='utf-8'
    )
    human_handler.setLevel(logging.INFO)
    human_formatter = logging.Formatter(
        '%(asctime)s [%(levelname)s] %(name)s (%(filename)s:%(lineno)d): %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    human_handler.setFormatter(human_formatter)
    logger.addHandler(human_handler)

    logger.info(f"Logger initialized: log_dir={LOG_DIR}")

    return logger


# Create default logger
logger = setup_logger()


# Convenience functions
def log_analysis_start(file_path, provider, model):
    """Log start of crash analysis"""
    logger.info(
        f"Starting crash analysis",
        extra={'file_path': file_path, 'provider': provider, 'model': model}
    )


def log_analysis_complete(file_path, provider, cost, tokens, duration_ms):
    """Log successful analysis completion"""
    logger.info(
        f"Analysis completed successfully",
        extra={
            'file_path': file_path,
            'provider': provider,
            'cost': cost,
            'tokens': tokens,
            'duration_ms': duration_ms
        }
    )


def log_analysis_error(file_path, provider, error):
    """Log analysis error"""
    logger.error(
        f"Analysis failed: {error}",
        extra={'file_path': file_path, 'provider': provider},
        exc_info=True
    )


def log_api_call(provider, model, prompt_tokens, completion_tokens=None):
    """Log AI API call"""
    logger.debug(
        f"AI API call",
        extra={
            'provider': provider,
            'model': model,
            'tokens': {
                'prompt': prompt_tokens,
                'completion': completion_tokens
            }
        }
    )
