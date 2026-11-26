$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$stateFile = Join-Path $project 'platform-design/renderer/data/remote-host/processes.json'
if (!(Test-Path -LiteralPath $stateFile)) { Write-Output 'No saved remote hosting session.'; return }
$session = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
foreach ($saved in $session.processes) {
    $running = Get-Process -Id $saved.id -ErrorAction SilentlyContinue
    if ($running -and $running.StartTime.ToUniversalTime().Ticks -eq ([datetime]$saved.started).ToUniversalTime().Ticks -and $running.Path -eq $saved.path) {
        Stop-Process -Id $running.Id
    }
}
Remove-Item -LiteralPath $stateFile
Write-Output 'Remote sharing stopped. Saved rooms and decks remain on disk.'
