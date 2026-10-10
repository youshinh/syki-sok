# Memory and CPU time of ONE isolated test app and of the msedgewebview2 processes that belong to it (found by the profile folder in
# their command line, never by name alone: other apps run WebView2 too). Read-only. Used by v2_perf.mjs; prints one JSON object on stdout.
#   powershell -NoProfile -File proc_mem.ps1 -AppPid <pid> -Profile <the folder of the app's WebView2 data> [-WithCmd]
# Role: app | browser | renderer | gpu | utility-network | utility-storage | utility | crashpad | other.
# type = the Chromium process type taken from the command line's --type= : app (the syki exe itself) | browser (no --type=) | gpu-process |
#   renderer | utility | crashpad-handler | other types as they come. subtype = the --utility-sub-type= of a utility process (null otherwise).
# ws = working set (includes pages shared with other processes), pws = private working set (pages only this process holds),
# privateBytes = committed private memory, cpuMs = CPU time (user + kernel) the process has used since it started.
# `at` (epoch ms) is the moment the process list was read, so two snapshots give a CPU percentage: sum(delta cpuMs) / delta at.
# -WithCmd adds `cmd` (the full command line) to every process: v2_perf.mjs uses it once per run to prove that --browser-args reached the processes.
param([int]$AppPid = 0, [Parameter(Mandatory = $true)][string]$Profile, [switch]$WithCmd)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)   # Node reads stdout as UTF-8
$prof = $Profile.ToLowerInvariant().Replace('/', '\').TrimEnd('\')
$all = Get-CimInstance Win32_Process
$at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$mine = @()
foreach ($p in $all) {
  $cmd = $p.CommandLine
  if ($AppPid -gt 0 -and $p.ProcessId -eq $AppPid) { $mine += $p; continue }
  if ($p.Name -eq 'msedgewebview2.exe' -and $cmd -and $cmd.ToLowerInvariant().Contains($prof)) { $mine += $p }
}
$rows = @()
if ($mine.Count -gt 0) {
  $filter = ($mine | ForEach-Object { 'IDProcess=' + $_.ProcessId }) -join ' OR '
  $raw = @{}
  foreach ($r in (Get-CimInstance Win32_PerfRawData_PerfProc_Process -Filter $filter)) { $raw[[int]$r.IDProcess] = $r }
  foreach ($p in $mine) {
    $cmd = [string]$p.CommandLine
    $role = 'other'
    $type = 'browser'
    $subtype = $null
    if ($p.ProcessId -eq $AppPid) { $role = 'app'; $type = 'app' }
    elseif ($cmd -match '--type=(\S+)') {
      $t = $Matches[1]
      $type = $t
      if ($cmd -match '--utility-sub-type=(\S+)') { $subtype = $Matches[1] }
      if ($t -eq 'utility') {
        if ($cmd -match 'NetworkService') { $role = 'utility-network' } elseif ($cmd -match 'StorageService') { $role = 'utility-storage' } else { $role = 'utility' }
      } elseif ($t -eq 'gpu-process') { $role = 'gpu' } elseif ($t -eq 'crashpad-handler') { $role = 'crashpad' } else { $role = $t }
    } else { $role = 'browser' }
    $perf = $raw[[int]$p.ProcessId]
    $row = [ordered]@{
      pid = [int]$p.ProcessId; ppid = [int]$p.ParentProcessId; name = $p.Name; role = $role; type = $type; subtype = $subtype
      ws = [int64]$p.WorkingSetSize
      pws = if ($perf) { [int64]$perf.WorkingSetPrivate } else { -1 }
      privateBytes = if ($perf) { [int64]$perf.PrivateBytes } else { -1 }
      cpuMs = [math]::Round(([double]$p.KernelModeTime + [double]$p.UserModeTime) / 10000.0, 1)
    }
    if ($WithCmd) { $row['cmd'] = $cmd }
    $rows += [pscustomobject]$row
  }
}
[pscustomobject]@{ at = $at; processes = @($rows) } | ConvertTo-Json -Depth 4 -Compress
