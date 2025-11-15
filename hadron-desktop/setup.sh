#!/bin/bash
# Hadron Desktop - Quick Setup Script

set -e

echo "======================================"
echo "Hadron Desktop - Quick Setup"
echo "======================================"
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install from https://nodejs.org/"
    exit 1
fi
echo "✅ Node.js $(node --version)"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found."
    exit 1
fi
echo "✅ npm $(npm --version)"

# Check Rust
if ! command -v rustc &> /dev/null; then
    echo "❌ Rust not found. Please install from https://rustup.rs/"
    exit 1
fi
echo "✅ Rust $(rustc --version)"

# Check Python
if command -v python3 &> /dev/null; then
    PYTHON_CMD=python3
elif command -v python &> /dev/null; then
    PYTHON_CMD=python
else
    echo "❌ Python not found. Please install Python 3.10+"
    exit 1
fi
echo "✅ Python $($PYTHON_CMD --version)"

echo ""
echo "📦 Installing dependencies..."
echo ""

# Install Node.js dependencies
echo "Installing Node.js packages..."
npm install

# Install Python dependencies
echo ""
echo "Installing Python packages..."
cd python
$PYTHON_CMD -m pip install -r requirements.txt
cd ..

echo ""
echo "======================================"
echo "✅ Setup Complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Set your OpenAI API key:"
echo "   export OPENAI_API_KEY='your-key-here'"
echo ""
echo "2. Run the development server:"
echo "   npm run tauri dev"
echo ""
echo "3. Or build for production:"
echo "   npm run tauri build"
echo ""
echo "📖 See GETTING-STARTED.md for more info"
echo ""
