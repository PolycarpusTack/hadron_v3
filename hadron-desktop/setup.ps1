# Hadron Desktop - Quick Setup Script (Windows PowerShell)

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Hadron Desktop - Quick Setup" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "📋 Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js not found. Please install from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# Check npm
try {
    $npmVersion = npm --version
    Write-Host "✅ npm $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ npm not found." -ForegroundColor Red
    exit 1
}

# Check Rust
try {
    $rustVersion = rustc --version
    Write-Host "✅ Rust $rustVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Rust not found. Please install from https://rustup.rs/" -ForegroundColor Red
    exit 1
}

# Check Python
try {
    $pythonVersion = python --version
    Write-Host "✅ Python $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Python not found. Please install Python 3.10+" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
Write-Host ""

# Install Node.js dependencies
Write-Host "Installing Node.js packages..." -ForegroundColor Cyan
npm install

# Install Python dependencies
Write-Host ""
Write-Host "Installing Python packages..." -ForegroundColor Cyan
Set-Location python
python -m pip install -r requirements.txt
Set-Location ..

Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host "✅ Setup Complete!" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Set your OpenAI API key:" -ForegroundColor White
Write-Host '   $env:OPENAI_API_KEY="your-key-here"' -ForegroundColor Gray
Write-Host ""
Write-Host "2. Run the development server:" -ForegroundColor White
Write-Host "   npm run tauri dev" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Or build for production:" -ForegroundColor White
Write-Host "   npm run tauri build" -ForegroundColor Gray
Write-Host ""
Write-Host "📖 See GETTING-STARTED.md for more info" -ForegroundColor Cyan
Write-Host ""
