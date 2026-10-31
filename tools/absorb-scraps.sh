#!/usr/bin/env bash
# absorb-scraps.sh - Absorb unabsorbed scrap notes into wiki/ via an LLM engine.
# Multi-PC safe: pre-archive backup + in-place clear (never hard-delete today's file).
set -u

SCRAP_DIR=""
ENGINE="auto"
MODEL=""
API_URL=""
STALE_DAYS=3
DRY_RUN=0

say() { printf '[absorb-scraps] %s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --scrap-dir)   SCRAP_DIR="$2"; shift 2 ;;
    --engine)      ENGINE="$2"; shift 2 ;;
    --model)       MODEL="$2"; shift 2 ;;
    --api-url)     API_URL="$2"; shift 2 ;;
    --stale-days)  STALE_DAYS="$2"; shift 2 ;;
    --dry-run)     DRY_RUN=1; shift ;;
    -h|--help)     echo "usage: absorb-scraps.sh [--scrap-dir DIR] [--engine auto|claude|codex|agy|ollama|openai-compat] [--model M] [--api-url URL] [--stale-days N] [--dry-run]"; exit 0 ;;
    *)             echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRAP_PATTERN='^[0-9]{4}-[0-9]{2}-[0-9]{2}( [^)]+)?(_conflict.*)?\.md$'
ABSORBED='^[[:space:]]*<!--[[:space:]]*syki:absorbed.*-->[[:space:]]*$'

find_syki_cli() {
  for c in "$(dirname "$SCRIPT_DIR")/syki" "$(dirname "$SCRIPT_DIR")/syki-cli" "$(dirname "$SCRIPT_DIR")/syki-cli.exe" "./syki" "./syki-cli" "./syki-cli.exe"; do
    if [ -f "$c" ] && [ -x "$c" ]; then printf '%s\n' "$c"; return 0; fi
  done
  if command -v syki >/dev/null 2>&1; then command -v syki; return 0; fi
  if command -v syki-cli >/dev/null 2>&1; then command -v syki-cli; return 0; fi
  printf ''
}

compute_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1
  else
    printf ''
  fi
}

epoch_from_date() {
  # macOS BSD date (-j -f) -> GNU date (-d) -> python3 fallback
  if date -j -f "%Y-%m-%d" "$1" +%s >/dev/null 2>&1; then
    date -j -f "%Y-%m-%d" "$1" +%s 2>/dev/null
  elif date -d "$1" +%s >/dev/null 2>&1; then
    date -d "$1" +%s 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import time; print(int(time.mktime(time.strptime('$1', '%Y-%m-%d'))))" 2>/dev/null
  else
    echo 0
  fi
}

is_absorbed() {
  t="$(sed -e 's/[[:space:]]*$//' -e '/^$/d' "$1" | head -n 1)"
  [ -z "$t" ] && return 0
  printf '%s' "$t" | grep -E "$ABSORBED" >/dev/null && return 0
  return 1
}

# 1) Resolve ScrapDir
SYKI_CLI=""
case "$SCRIPT_DIR" in
  */tools/knowledge-compiler) in_kc=1 ;;
  *) in_kc=0 ;;
esac
if [ -z "$SCRAP_DIR" ]; then
  if [ "$in_kc" -eq 0 ] && [ -f "$SCRIPT_DIR/AGENTS.md" ]; then
    SCRAP_DIR="$SCRIPT_DIR"
  else
    SYKI_CLI="$(find_syki_cli)"
    if [ -n "$SYKI_CLI" ]; then
      raw="$("$SYKI_CLI" info 2>/dev/null | grep -E '"scrap_dir"[[:space:]]*:' | head -n 1)"
      SCRAP_DIR="$(printf '%s' "$raw" | sed -E 's/.*"scrap_dir"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')"
    fi
    [ -z "$SCRAP_DIR" ] && SCRAP_DIR="$HOME/Documents/syki-sok/scraps"
  fi
fi
mkdir -p "$SCRAP_DIR" 2>/dev/null || true

# 2) Bootstrap
for d in wiki archive; do
  if [ ! -d "$SCRAP_DIR/$d" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then say "DRYRUN: mkdir $SCRAP_DIR/$d"; else mkdir -p "$SCRAP_DIR/$d"; fi
  fi
done
for f in AGENTS.md CLAUDE.md INDEX.md .syki-ignore; do
  if [ ! -f "$SCRAP_DIR/$f" ] && [ -f "$SCRIPT_DIR/knowledge-compiler/$f" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then say "DRYRUN: copy $SCRAP_DIR/knowledge-compiler/$f -> $SCRAP_DIR/$f"
    else cp "$SCRIPT_DIR/knowledge-compiler/$f" "$SCRAP_DIR/$f"; fi
  fi
done

# 3) Stale GC
today="$(date +%Y-%m-%d)"
gc=0
for f in "$SCRAP_DIR"/*.md; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  case "$base" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].md) ;;
    *) continue ;;
  esac
  file_epoch="$(epoch_from_date "${base%.md}")"
  age_days=$(( ( $(date +%s) - file_epoch ) / 86400 ))
  [ "$age_days" -le "$STALE_DAYS" ] && continue
  if is_absorbed "$f"; then
    gc=$((gc + 1))
    [ "$DRY_RUN" -eq 0 ] && rm -f "$f"
  fi
done
say "stale GC: $gc file(s) eligible (older than $STALE_DAYS days)"

# 4) Scan unabsorbed scraps (root only)
candidates=""
count=0
for f in "$SCRAP_DIR"/*.md; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  printf '%s' "$base" | grep -E "$SCRAP_PATTERN" >/dev/null || continue
  is_absorbed "$f" && continue
  candidates="$candidates
$base"
  count=$((count + 1))
done
if [ "$count" -eq 0 ]; then
  echo "No unabsorbed scraps in $SCRAP_DIR."
  exit 0
fi

# 5) Engine resolution
resolved="$ENGINE"
if [ "$resolved" = "auto" ]; then
  if [ -n "${SYKI_ABSORB_ENGINE:-}" ]; then resolved="$SYKI_ABSORB_ENGINE"
  else
    resolved="openai-compat"
    for e in claude codex agy ollama; do
      if command -v "$e" >/dev/null 2>&1; then resolved="$e"; break; fi
    done
  fi
fi
if [ "$DRY_RUN" -eq 1 ]; then
  echo "ScrapDir: $SCRAP_DIR"
  echo "Engine:   $resolved"
  printf '%s\n' "$candidates" | sed 's/^/  candidate: /'
  exit 0
fi

# 6) Pre-archive backup
stamp="$(date +%H%M%S)"
month="$(date +%Y-%m)"
arch="$SCRAP_DIR/archive/$month"
mkdir -p "$arch"
for f in "$SCRAP_DIR"/*.md; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  printf '%s' "$base" | grep -E "$SCRAP_PATTERN" >/dev/null || continue
  is_absorbed "$f" && continue
  cp "$f" "$arch/${base%.md}_$stamp.md"
done

# 7) Invoke engine
prompt="AGENTS.md と INDEX.md を読み、未処理の Scrap ファイル ($(printf '%s' "$candidates" | tr '\n' ' ' | sed 's/^ *//;s/ *$//')) を wiki/ へ統合・結晶化し、INDEX.md を更新してください。"
(
  cd "$SCRAP_DIR" || exit 1
  case "$resolved" in
    claude)        if [ -n "$MODEL" ]; then claude --model "$MODEL" -p "$prompt"; else claude -p "$prompt"; fi ;;
    codex)         codex exec "$prompt" ;;
    agy)           agy -p "$prompt" ;;
    ollama)        ollama run "${MODEL:-qwen2.5:14b}" "$prompt" ;;
    openai-compat)
      base="${API_URL:-${SYKI_ABSORB_API_URL:-http://127.0.0.1:8080/v1}}"
      body="$(printf '{"model":"%s","messages":[{"role":"user","content":"%s"}]}' "${MODEL:-local}" \
        "$(printf '%s' "$prompt" | sed 's/\\/\\\\/g; s/"/\\"/g')")"
      hdr=(-H 'Content-Type: application/json; charset=utf-8')
      [ -n "${SYKI_ABSORB_API_KEY:-}" ] && hdr+=(-H "Authorization: Bearer $SYKI_ABSORB_API_KEY")
      curl -sS "${hdr[@]}" -X POST "${base%/}/chat/completions" -d "$body"
      ;;
  esac
)

# 8) Multi-PC safe cleanup (in-place clear)
marker="<!-- syki:absorbed $(date +%Y-%m-%dT%H:%M:%S) -->"
for f in "$SCRAP_DIR"/*.md; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  printf '%s' "$base" | grep -E "$SCRAP_PATTERN" >/dev/null || continue
  is_absorbed "$f" && continue
  if [ "$base" = "$today.md" ]; then
    hash="$(compute_sha256 "$f")"
    printf '%s\n' "$marker" > "$f"
    if [ -n "$SYKI_CLI" ] && "$SYKI_CLI" info 2>/dev/null | grep -E '"gui_running"[[:space:]]*:[[:space:]]*true' >/dev/null; then
      tab="$("$SYKI_CLI" tab list --json 2>/dev/null | grep -F "$f" | sed -E 's/.*"id"[[:space:]]*:[[:space:]]*"?([^",]*)"?.*/\1/' | head -n 1)"
      [ -n "$tab" ] && "$SYKI_CLI" buffer set --tab "$tab" --expected-hash "$hash" "$marker"
    fi
  else
    rm -f "$f"
  fi
done
say "absorbed $count scrap(s) via $resolved"
