# One-time database setup for Interview Coach (PostgreSQL).
# Run it from the project folder:   .\setup-database.ps1
#
# What it does:
#   1. finds PostgreSQL on this computer (or installs it with winget if it is missing)
#   2. creates a database user "coach" and a database "interview_coach"
#   3. writes DATABASE_URL into artifacts\api-server\.env (your old .env is saved as .env.bak)
# The password the app uses is generated for you. You never have to type it or share it.
# Running it again is safe: your data is kept, only the app password is renewed.
param([int]$Port = 5432)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $root 'artifacts\api-server\.env'
$dbName = 'interview_coach'
$dbUser = 'coach'

function Say([string]$text, [string]$color = 'Cyan') { Write-Host $text -ForegroundColor $color }

function Find-PgBin {
  $cmd = Get-Command psql.exe -ErrorAction SilentlyContinue
  if ($cmd) { return (Split-Path -Parent $cmd.Source) }
  $found = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($found) { return (Split-Path -Parent $found.FullName) }
  return $null
}

function New-Secret([int]$length = 24) {
  $chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $bytes = New-Object byte[] $length
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return (-join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] }))
}

function ConvertTo-Plain([System.Security.SecureString]$secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Say ''
Say 'Interview Coach - database setup'
Say '--------------------------------'

$bin = Find-PgBin
$adminPw = $null

if (-not $bin) {
  Say 'PostgreSQL is not installed on this computer.' 'Yellow'
  $answer = Read-Host 'Install PostgreSQL 16 now with winget? A Windows permission window will appear. (y/n)'
  if ($answer -notmatch '^(y|yes)$') {
    Say 'OK. Install PostgreSQL 16 from https://www.postgresql.org/download/windows/ and run this script again.' 'Yellow'
    return
  }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Say 'winget was not found on this computer. Install PostgreSQL 16 from https://www.postgresql.org/download/windows/ and run this script again.' 'Yellow'
    return
  }
  $secure = Read-Host "Choose a password for the PostgreSQL admin user 'postgres' (remember it; use letters and numbers only, at least 6)" -AsSecureString
  $adminPw = ConvertTo-Plain $secure
  if ($adminPw -notmatch '^[A-Za-z0-9]{6,}$') {
    Say 'Please use at least 6 letters or numbers, with no spaces or symbols.' 'Yellow'
    return
  }
  Say 'Installing PostgreSQL 16. This can take a few minutes...'
  winget install -e --id PostgreSQL.PostgreSQL.16 --accept-package-agreements --accept-source-agreements --override "--mode unattended --unattendedmodeui none --superpassword $adminPw --serverport $Port"
  $bin = Find-PgBin
  if (-not $bin) {
    Say 'The installation did not finish. Install PostgreSQL 16 yourself from https://www.postgresql.org/download/windows/ and run this script again.' 'Red'
    return
  }
} else {
  Say "Found PostgreSQL in $bin"
  $secure = Read-Host "Enter the password of the PostgreSQL admin user 'postgres' (the one you chose when you installed PostgreSQL)" -AsSecureString
  $adminPw = ConvertTo-Plain $secure
}

$psql = Join-Path $bin 'psql.exe'
$isReady = Join-Path $bin 'pg_isready.exe'

Say 'Waiting for PostgreSQL to start...'
$up = $false
for ($i = 0; $i -lt 30; $i++) {
  & $isReady -h localhost -p $Port *> $null
  if ($LASTEXITCODE -eq 0) { $up = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $up) {
  Say "PostgreSQL is not answering on port $Port. Open Windows Services, start 'postgresql-x64-16', then run this script again." 'Red'
  return
}

$env:PGPASSWORD = $adminPw
function Run-Sql([string]$sql, [string]$database = 'postgres') {
  $out = & $psql -h localhost -p $Port -U postgres -d $database -v ON_ERROR_STOP=1 -tA -c $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw ("PostgreSQL said: " + ($out | Out-String).Trim()) }
  return (($out | Out-String).Trim())
}

try {
  Run-Sql 'SELECT 1' | Out-Null
} catch {
  Say "Could not log in as 'postgres'. The admin password is probably wrong." 'Red'
  Say $_.Exception.Message 'Red'
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  return
}

$appPw = New-Secret 24
try {
  if ((Run-Sql "SELECT 1 FROM pg_roles WHERE rolname = '$dbUser'") -eq '1') {
    Run-Sql "ALTER ROLE $dbUser WITH LOGIN PASSWORD '$appPw'" | Out-Null
    Say "Database user '$dbUser' already existed. Its password was renewed."
  } else {
    Run-Sql "CREATE ROLE $dbUser WITH LOGIN PASSWORD '$appPw'" | Out-Null
    Say "Created database user '$dbUser'."
  }
  if ((Run-Sql "SELECT 1 FROM pg_database WHERE datname = '$dbName'") -eq '1') {
    Say "Database '$dbName' already exists. Your data is kept."
  } else {
    Run-Sql "CREATE DATABASE $dbName OWNER $dbUser" | Out-Null
    Say "Created database '$dbName'."
  }
} catch {
  Say 'Something went wrong while creating the database:' 'Red'
  Say $_.Exception.Message 'Red'
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  return
}

# prove that the app user can really log in before saving anything
$env:PGPASSWORD = $appPw
& $psql -h localhost -p $Port -U $dbUser -d $dbName -tA -c 'SELECT 1' *> $null
$appLogin = $LASTEXITCODE
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
if ($appLogin -ne 0) {
  Say "The new database user '$dbUser' could not log in. Nothing was written to .env." 'Red'
  return
}

$url = "postgres://${dbUser}:${appPw}@localhost:${Port}/${dbName}"
$lines = @()
if (Test-Path $envFile) {
  Copy-Item $envFile "$envFile.bak" -Force
  $lines = @([System.IO.File]::ReadAllLines($envFile))
}
$lines = @($lines | Where-Object { $_ -notmatch '^\s*DATABASE_URL\s*=' })
$lines += "DATABASE_URL=$url"
[System.IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))

Say ''
Say 'Done. The database is ready and DATABASE_URL was saved in artifacts\api-server\.env' 'Green'
Say 'Next step:  .\start.ps1' 'Green'
Say 'Your old history (the JSON files) is imported automatically the first time the server starts.' 'Green'
