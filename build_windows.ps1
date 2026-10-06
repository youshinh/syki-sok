# Windows Build Script for syki::sok
# Builds a clean, windowed GUI binary without opening a command prompt / console window.

Write-Host "Building syki.exe (GUI subsystem)..." -ForegroundColor Cyan

go build -ldflags="-H windowsgui -s -w" -trimpath -o syki.exe .

if ($LASTEXITCODE -eq 0) {
    Write-Host "Successfully built syki.exe without console window!" -ForegroundColor Green
} else {
    Write-Host "Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

# The console-subsystem twin for scripts, agents and CI: PowerShell waits for it and gets its real
# exit codes and output. The version is read from app.go (a plain `go build ./cmd/syki-cli` says "dev").
Write-Host "Building syki-cli.exe (console subsystem)..." -ForegroundColor Cyan
$version = (Select-String -Path app.go -Pattern 'AppVersion\s*=\s*"(\d+\.\d+\.\d+)"').Matches[0].Groups[1].Value
$ldflags = "-s -w -X main.version=$version"
go build "-ldflags=$ldflags" -trimpath -o syki-cli.exe ./cmd/syki

if ($LASTEXITCODE -eq 0) {
    Write-Host "Successfully built syki-cli.exe!" -ForegroundColor Green
} else {
    Write-Host "Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}
