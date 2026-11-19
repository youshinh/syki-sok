# Stability, Scale & Concurrency Verification Suite

3 層構成で「大量ノート」「超長文・偏った形状」「並列処理・複合操作」「長時間運用リーク」を検証するスイートです。すべてテスト用一時ディレクトリ／ヘッドレスモック上で動作し、ユーザーの実設定や実ノートには触れません。

## 1. Go バックエンド並列ストレス＆スケールベンチマーク

```powershell
# 通常規模（CI / 日常回帰用、数秒）
go test -v ./pkg/search -run TestSearchStress
go test -v ./pkg/semindex -run TestSemindexStress
go test -v ./cmd/syki-gui -run TestAppStress

# Config / Quick Capture / Mobile Drop / Inbox 並列ストレスのみ実行
go test -v ./cmd/syki-gui -run TestAppStress_ConfigQuickCaptureMobileDropAndInbox

# アトミックファイル保存 / agents.yaml 競合保護ストレスのみ実行
go test -v ./cmd/syki-gui -run TestAppStress_AtomicFileAndAgentsConfigConcurrency

# 高負荷モード（2,000ファイル / 800ファイル / サブシステム高並列）
$env:SYKI_STRESS="1"
go test -v ./pkg/search -run TestSearchStress
go test -v ./pkg/semindex -run TestSemindexStress
go test -v ./cmd/syki-gui -run TestAppStress
Remove-Item Env:SYKI_STRESS

# スケールベンチマーク（実行時間・メモリ確保量）
go test -run=^$ -bench="BenchmarkSearchScale|BenchmarkCollectTags" -benchmem -benchtime=1x ./pkg/search
go test -run=^$ -bench=BenchmarkSemindexScale -benchmem -benchtime=1x ./pkg/semindex
```

※ Windows 上で `gcc` がない環境では `-race` が無効なため、CI（Windows/macOS）等 `CGO_ENABLED=1` 環境では `go test -race` でのデータ競合検出も併せて有効です。

## 2. フロントエンド JS 複合ファジング & 病理的ノート形状テスト

```powershell
# 複合ライフサイクルファザー（タブ開閉・編集・RPC・保存遅延/競合・スクラップ通知・AI）
node tests/stability_lifecycle_fuzz_test.mjs
node tests/stability_lifecycle_fuzz_test.mjs --count 400 --steps 20

# Settings モーダル状態遷移ストレス & 実 app.js VM 未保存ノート隔離検証（120 + 20 サイクル）
node tests/settings_modal_stress_test.mjs

# 大規模ノート性能 & プレビュー 250K 文字上限ガード（unclosed fence 保護含む）
node tests/huge_note_perf_test.mjs

# 病理的ノート形状（多行・巨大1行・見出し/コメント密集・サロゲートペア・HTMLテーブル）
node tests/pathological_note_shapes_test.mjs
$env:SYKI_STRESS="1"; node tests/pathological_note_shapes_test.mjs; Remove-Item Env:SYKI_STRESS
```

## 3. 実ブラウザ (Headless Edge) スケール＆ソーク計測

```powershell
# P1(40タブ), P2(80k行 & 300k1行), P3(20タブx100KBセッション), P4(混合操作ソーク), P5(設定画面/Mobile Drop/コマンドパレット/スクラップ到着)
node tools/stress/run_stress.mjs --soak-sec 20

# 特定プロファイルのみ / 長時間ソーク（例: 5分）
node tools/stress/run_stress.mjs --profiles p5 --out stress-p5.json
node tools/stress/run_stress.mjs --profiles p4 --soak-sec 300 --out stress-soak.json
```
