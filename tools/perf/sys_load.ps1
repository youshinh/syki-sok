# What else the PC is doing: system CPU % and the busiest processes over a short window (two samples of every process's CPU time,
# from Win32_Process, so it does not depend on the language of the performance-counter names). Read-only.
# Used by v2_perf.mjs; prints one JSON object on stdout.
#   powershell -NoProfile -File sys_load.ps1 [-Seconds 1] [-Info]       (-Info adds the machine: CPU, RAM, OS, power, display)
# cpu per process = % of ONE logical processor; systemCpuPct = all processes (not the idle process) / (logical processors).
param([double]$Seconds = 1.0, [switch]$Info)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)   # Node reads stdout as UTF-8 (the Japanese power-plan name)
function Sample {
  $h = @{}
  foreach ($p in (Get-CimInstance Win32_Process | Select-Object ProcessId, Name, KernelModeTime, UserModeTime)) {
    if ($p.ProcessId -eq 0) { continue }
    $h[[int]$p.ProcessId] = [pscustomobject]@{ name = [string]$p.Name; t = [double]($p.KernelModeTime + $p.UserModeTime) }
  }
  $h
}
$sw = [Diagnostics.Stopwatch]::StartNew()
$a = Sample
$t0 = $sw.Elapsed.TotalSeconds
Start-Sleep -Milliseconds ([int]($Seconds * 1000))
$b = Sample
$dt = $sw.Elapsed.TotalSeconds - $t0
$ncpu = [int](Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$rows = @()
$total = 0.0
foreach ($id in $b.Keys) {
  if (-not $a.ContainsKey($id)) { continue }
  $pct = 100.0 * (($b[$id].t - $a[$id].t) / 1e7) / $dt   # CPU seconds used / wall seconds, as % of one logical processor
  $total += $pct
  $rows += [pscustomobject]@{ pid = [int]$id; name = $b[$id].name; cpu = [math]::Round($pct, 1) }
}
$top = @($rows | Sort-Object cpu -Descending | Select-Object -First 8)
$out = [ordered]@{ seconds = [math]::Round($dt, 2); logicalCpus = $ncpu; systemCpuPct = [math]::Round($total / $ncpu, 1); top = $top }
if ($Info) {
  $cs = Get-CimInstance Win32_ComputerSystem; $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; $os = Get-CimInstance Win32_OperatingSystem
  $bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
  $plan = (powercfg /getactivescheme) -join ' '
  $gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { [ordered]@{ name = $_.Name; refreshHz = $_.CurrentRefreshRate; width = $_.CurrentHorizontalResolution; height = $_.CurrentVerticalResolution } })
  $out['machine'] = [ordered]@{
    model = ($cs.Manufacturer + ' ' + $cs.Model).Trim(); cpu = $cpu.Name; cores = $cpu.NumberOfCores; logical = $cpu.NumberOfLogicalProcessors
    ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1); freeRamGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
    os = ($os.Caption + ' ' + $os.Version)
    battery = if ($bat) { 'present: status ' + $bat.BatteryStatus + ' (2 = on AC), charge ' + $bat.EstimatedChargeRemaining + '%' } else { 'none (desktop, always on mains power)' }
    powerPlan = $plan.Trim()
    displays = $gpus
  }
}
$out | ConvertTo-Json -Depth 6 -Compress
