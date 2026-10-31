#!/usr/bin/env pwsh
# absorb-scraps.ps1 - Absorb unabsorbed scrap notes into wiki/ via an LLM engine.
# Multi-PC safe: pre-archive backup + in-place clear (never hard-delete today's file).
[CmdletBinding()]
param(
    [string]$ScrapDir = "",
    [ValidateSet("auto", "claude", "codex", "agy", "ollama", "openai-compat")]
    [string]$Engine = "auto",
    [string]$Model = "",
    [string]$ApiUrl = "",
    [int]$StaleDays = 3,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$AbsorbedPattern = '^<!--\s*syki:absorbed\b.*-->$'
$ScrapPattern    = '^\d{4}-\d{2}-\d{2}(?:\s+\(.+\)|_conflict.*)?\.md$'
$Utf8NoBom       = New-Object System.Text.UTF8Encoding($false)

function Say($msg) { Write-Host "[absorb-scraps] $msg" }

function Find-SykiCli {
    $candidates = @(
        (Join-Path (Split-Path $PSScriptRoot -Parent) "syki-cli.exe"),
        ".\syki-cli.exe"
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) { return $c }
    }
    $cmd = Get-Command syki-cli -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Read-Body($path) {
    $raw = Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue
    if (-not $raw) { return "" }
    return $raw
}

function IsAbsorbed($path) {
    $t = (Read-Body $path).Trim()
    if (-not $t) { return $true }
    return ($t -match $AbsorbedPattern)
}

# 1) Resolve ScrapDir
$sykiCli = $null
$inKC = ($PSScriptRoot -like "*tools\knowledge-compiler")
if (-not $ScrapDir) {
    if (-not $inKC -and (Test-Path (Join-Path $PSScriptRoot "AGENTS.md"))) {
        $ScrapDir = $PSScriptRoot
    } else {
        $sykiCli = Find-SykiCli
        if ($sykiCli) {
            try {
                $info = & $sykiCli info | ConvertFrom-Json
                if ($info -and $info.scrap_dir) { $ScrapDir = $info.scrap_dir }
            } catch { Say "syki-cli info failed: $($_.Exception.Message)" }
        }
        if (-not $ScrapDir) { $ScrapDir = Join-Path $HOME "Documents\syki-sok\scraps" }
    }
}
$ScrapDir = (Resolve-Path -LiteralPath $ScrapDir -ErrorAction SilentlyContinue)
if (-not $ScrapDir) { $ScrapDir = Join-Path $HOME "Documents\syki-sok\scraps" }
$ScrapDir = [string]$ScrapDir

# 2) Bootstrap
$templates = Join-Path $PSScriptRoot "knowledge-compiler"
foreach ($d in @("wiki", "archive")) {
    $p = Join-Path $ScrapDir $d
    if (-not (Test-Path -LiteralPath $p)) {
        if ($DryRun) { Say "DRYRUN: mkdir $p" } else { New-Item -ItemType Directory -Path $p -Force | Out-Null }
    }
}
foreach ($f in @("AGENTS.md", "CLAUDE.md", "INDEX.md", ".syki-ignore")) {
    $dst = Join-Path $ScrapDir $f
    if (-not (Test-Path -LiteralPath $dst)) {
        $src = Join-Path $templates $f
        if (Test-Path -LiteralPath $src) {
            if ($DryRun) { Say "DRYRUN: copy $src -> $dst" }
            else { Copy-Item -LiteralPath $src -Destination $dst -Force }
        }
    }
}

# 3) Stale GC
$today = (Get-Date).ToString("yyyy-MM-dd")
$gc = 0
Get-ChildItem -LiteralPath $ScrapDir -File -Filter "*.md" | ForEach-Object {
    if ($_.Name -notmatch '^\d{4}-\d{2}-\d{2}\.md$') { return }
    $d = [datetime]::ParseExact($_.Name.Substring(0, 10), "yyyy-MM-dd", $null)
    if (((Get-Date) - $d).Days -le $StaleDays) { return }
    if (IsAbsorbed $_.FullName) {
        $gc++
        if (-not $DryRun) { Remove-Item -LiteralPath $_.FullName -Force }
    }
}
Say "stale GC: $gc file(s) eligible (older than $StaleDays days)"

# 4) Scan unabsorbed scraps (root only)
$candidates = Get-ChildItem -LiteralPath $ScrapDir -File -Filter "*.md" |
    Where-Object { $_.Name -match $ScrapPattern -and -not (IsAbsorbed $_.FullName) } |
    Sort-Object Name
if (-not $candidates) {
    Write-Host "No unabsorbed scraps in $ScrapDir."
    exit 0
}

# 5) Engine resolution
$resolved = $Engine
if ($resolved -eq "auto") {
    if ($env:SYKI_ABSORB_ENGINE) { $resolved = $env:SYKI_ABSORB_ENGINE }
    else {
        $resolved = "openai-compat"
        foreach ($e in @("claude", "codex", "agy", "ollama")) {
            if (Get-Command $e -ErrorAction SilentlyContinue) { $resolved = $e; break }
        }
    }
}
if ($DryRun) {
    Write-Host "ScrapDir: $ScrapDir"
    Write-Host "Engine:   $resolved"
    foreach ($c in $candidates) { Write-Host "  candidate: $($c.Name)" }
    exit 0
}

# 6) Pre-archive backup
$stamp = (Get-Date).ToString("HHmmss")
$month = (Get-Date).ToString("yyyy-MM")
$archDir = Join-Path $ScrapDir "archive\$month"
New-Item -ItemType Directory -Path $archDir -Force | Out-Null
foreach ($c in $candidates) {
    Copy-Item -LiteralPath $c.FullName -Destination (Join-Path $archDir "$($c.BaseName)_$stamp.md") -Force
}

# 7) Invoke engine
$prompt = "AGENTS.md と INDEX.md を読み、未処理の Scrap ファイル ($($candidates.Name -join ', ')) を wiki/ へ統合・結晶化し、INDEX.md を更新してください。"
$engineOk = $false
Push-Location $ScrapDir
try {
    switch ($resolved) {
        "claude" {
            $a = @("-p", $prompt); if ($Model) { $a = @("--model", $Model) + $a }
            & claude @a
            $engineOk = ($LASTEXITCODE -eq 0)
        }
        "codex" {
            & codex exec $prompt
            $engineOk = ($LASTEXITCODE -eq 0)
        }
        "agy" {
            & agy -p $prompt
            $engineOk = ($LASTEXITCODE -eq 0)
        }
        "ollama" {
            $inlineCtx = "## INDEX.md`n$(Read-Body (Join-Path $ScrapDir 'INDEX.md'))`n"
            foreach ($c in $candidates) { $inlineCtx += "`n## $($c.Name)`n$(Read-Body $c.FullName)`n" }
            & ollama run $(if ($Model) { $Model } else { "qwen2.5:14b" }) "$prompt`n$inlineCtx"
            $engineOk = ($LASTEXITCODE -eq 0)
        }
        "openai-compat" {
            $base = if ($ApiUrl) { $ApiUrl } elseif ($env:SYKI_ABSORB_API_URL) { $env:SYKI_ABSORB_API_URL } else { "http://127.0.0.1:8080/v1" }
            $uri  = $base.TrimEnd("/") + "/chat/completions"
            $inlineCtx = "## AGENTS.md`n$(Read-Body (Join-Path $ScrapDir 'AGENTS.md'))`n`n## INDEX.md`n$(Read-Body (Join-Path $ScrapDir 'INDEX.md'))`n"
            foreach ($c in $candidates) { $inlineCtx += "`n## Scrap: $($c.Name)`n$(Read-Body $c.FullName)`n" }
            $jsonPrompt = "$prompt`n`n以下のJSON形式のみで出力してください: {`"wiki_files`": [{`"path`": `"wiki/YYYY-MM-DD-slug.md`", `"content`": `"...`"}], `"index_md`": `"...`"}`n`n$inlineCtx"
            $body = @{
                model = $(if ($Model) { $Model } else { "qwen3.8-flash-next-iq2_xs" })
                messages = @(@{ role = "user"; content = $jsonPrompt })
                response_format = @{ type = "json_object" }
            } | ConvertTo-Json -Depth 6
            $headers = @{}
            if ($env:SYKI_ABSORB_API_KEY) { $headers["Authorization"] = "Bearer $($env:SYKI_ABSORB_API_KEY)" }
            $resp = Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json; charset=utf-8" -Headers $headers -Body $body
            $rawJson = $resp.choices[0].message.content
            $parsed = $rawJson | ConvertFrom-Json
            if ($parsed.wiki_files) {
                foreach ($wf in $parsed.wiki_files) {
                    if ($wf.path -and $wf.content -and ($wf.path -match '^wiki/[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9_-]+\.md$')) {
                        [System.IO.File]::WriteAllText((Join-Path $ScrapDir $wf.path), $wf.content, $Utf8NoBom)
                    }
                }
            }
            if ($parsed.index_md) {
                [System.IO.File]::WriteAllText((Join-Path $ScrapDir "INDEX.md"), $parsed.index_md, $Utf8NoBom)
            }
            $engineOk = $true
        }
    }
} finally { Pop-Location }

if (-not $engineOk) {
    Write-Error "[absorb-scraps] Engine '$resolved' failed; raw scraps kept in place (archived backup in $archDir)."
    exit 1
}

# 8) Multi-PC safe cleanup (in-place clear)
$marker = "<!-- syki:absorbed $((Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')) -->`n"
foreach ($c in $candidates) {
    if ($c.Name -ieq "$today.md") {
        [System.IO.File]::WriteAllText($c.FullName, $marker, $Utf8NoBom)
        if ($sykiCli) {
            try {
                $info = & $sykiCli info | ConvertFrom-Json
                if ($info -and $info.gui_running) {
                    $tabs = & $sykiCli tab list --json | ConvertFrom-Json
                    $tab = $tabs | Where-Object { $_.path -ieq $c.FullName } | Select-Object -First 1
                    if ($tab) {
                        $buf = & $sykiCli buffer get --tab $tab.id --json | ConvertFrom-Json
                        if ($buf -and $buf.hash) {
                            & $sykiCli buffer set --tab $tab.id --expected-hash $buf.hash $marker | Out-Null
                        }
                    }
                }
            } catch { Say "buffer sync skipped: $($_.Exception.Message)" }
        }
    } else {
        Remove-Item -LiteralPath $c.FullName -Force
    }
}
Say "absorbed $($candidates.Count) scrap(s) via $resolved"
