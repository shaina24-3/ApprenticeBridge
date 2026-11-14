# setup_db.ps1 — Create the PostgreSQL database and user for ApprenticeBridge
# Run once before starting the backend for the first time.
#
# Usage:
#   .\setup_db.ps1
# You will be prompted for your postgres superuser password.

$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"

if (-not (Test-Path $psql)) {
    # Try PATH fallback
    $psql = "psql"
}

Write-Host ""
Write-Host "=== ApprenticeBridge — Database Setup ===" -ForegroundColor Cyan
Write-Host "This script creates the 'apprenticebridge_user' role and 'apprenticebridge' database."
Write-Host "You will need your PostgreSQL superuser (postgres) password."
Write-Host ""

$pgPassword = Read-Host -Prompt "Enter postgres superuser password" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgPassword)
)
$env:PGPASSWORD = $plain

$sql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'apprenticebridge_user') THEN
    CREATE ROLE apprenticebridge_user LOGIN PASSWORD 'ChooseYourOwnStrongPassword';
  END IF;
END
`$`$;

SELECT 'Role ready' AS status;
"@

Write-Host "`nCreating role apprenticebridge_user ..." -ForegroundColor Yellow
$result = $sql | & $psql -U postgres -h 127.0.0.1 -p 5432 2>&1
Write-Host $result

Write-Host "`nCreating database apprenticebridge ..." -ForegroundColor Yellow
$dbResult = & $psql -U postgres -h 127.0.0.1 -p 5432 -c "CREATE DATABASE apprenticebridge OWNER apprenticebridge_user;" 2>&1
if ($dbResult -match "already exists") {
    Write-Host "Database already exists — skipping." -ForegroundColor Green
} else {
    Write-Host $dbResult
}

Write-Host "`nGranting privileges ..." -ForegroundColor Yellow
$grantResult = & $psql -U postgres -h 127.0.0.1 -p 5432 -d apprenticebridge -c "GRANT ALL PRIVILEGES ON DATABASE apprenticebridge TO apprenticebridge_user;" 2>&1
Write-Host $grantResult

$env:PGPASSWORD = ""

Write-Host ""
Write-Host "=== Database setup complete ===" -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "  1. Run the backend:  .\start_backend.ps1"
Write-Host "  2. Seed data:        python seed_data.py"
Write-Host "  3. Create admin:     python create_admin.py"
