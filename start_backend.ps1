# start_backend.ps1 — Start the ApprenticeBridge FastAPI backend
# Runs on http://localhost:8000 (frontend connects here)
#
# Usage: .\start_backend.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$venvPython = "c:\Users\DELL\Documents\ApprenticeBridge-Backend-PRD 2\venv311\Scripts\python.exe"
$venvUvicorn = "c:\Users\DELL\Documents\ApprenticeBridge-Backend-PRD 2\venv311\Scripts\uvicorn.exe"

# Fall back to system python if venv not found
if (-not (Test-Path $venvUvicorn)) {
    Write-Host "venv not found at expected path. Trying system uvicorn..." -ForegroundColor Yellow
    $venvUvicorn = "uvicorn"
}

Write-Host ""
Write-Host "=== ApprenticeBridge Backend ===" -ForegroundColor Cyan
Write-Host "Starting FastAPI on http://localhost:8000"
Write-Host "API docs: http://localhost:8000/docs"
Write-Host "Press Ctrl+C to stop."
Write-Host ""

& $venvUvicorn app.main:app --reload --host 0.0.0.0 --port 8000
