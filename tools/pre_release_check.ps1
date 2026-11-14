# Pre-release verification gate for syki::sok.
# Mirrors CI (concurrency=4) + Go uncached tests + manual integrity checks.
$ErrorActionPreference = 'Stop'

Write-Host '== 1/3: Go tests (uncached) =='
go test -count=1 ./...
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '== 2/3: Frontend JS tests (CI concurrency=4) =='
$env:JS_TEST_CONCURRENCY = '4'
node tools/run_js_tests.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '== 3/3: Manual & doc check =='
python tools/check_manual.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'All pre-release gates passed!'
