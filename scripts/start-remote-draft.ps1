param([ValidateRange(1,65535)][int]$Port = 3210)
$ErrorActionPreference = 'Stop'
Write-Host 'Starting remote Cube Draft hosting...'
$project = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $project 'platform-design/renderer/data/remote-host'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$stateFile = Join-Path $runtime 'processes.json'
if (Test-Path -LiteralPath $stateFile) {
    $savedSession = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $liveCount = 0
    foreach ($saved in $savedSession.processes) {
        $running = Get-Process -Id $saved.id -ErrorAction SilentlyContinue
        if ($running -and $running.StartTime.ToUniversalTime().Ticks -eq ([datetime]$saved.started).ToUniversalTime().Ticks -and $running.Path -eq $saved.path) { $liveCount++ }
    }
    if ($savedSession.processes.Count -eq 2 -and $liveCount -eq 2) {
        Write-Output 'Remote hosting is already running.'
        Write-Output ("Friend link: " + $savedSession.url)
        return
    }
    throw 'A previous remote hosting session has stopped or only partially survived. Run scripts/stop-remote-draft.ps1, then start again.'
}
if ($env:DATA_ROOT -or $env:HOST -or $env:PORT) { throw 'Clear DATA_ROOT, HOST and PORT for this launcher; it uses the standard data directory and loopback address.' }
$tunnelFile = Join-Path $runtime 'cloudflared-2026.11.1.exe'
$expectedHash = '341deda3db5ec498a0482254d6c38c0b7cf01a30c37bb5dd95d2216d08955e35'
if (!(Test-Path -LiteralPath $tunnelFile)) {
    Write-Host 'Downloading Cloudflare Tunnel. This can take a moment...'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/download/2026.11.1/cloudflared-windows-amd64.exe' -OutFile $tunnelFile
}
if ((Get-FileHash -LiteralPath $tunnelFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Cloudflare Tunnel checksum mismatch. The downloaded program was not executed.' }
$serverProcess = $null
$tunnelProcess = $null
try {
    # Check availability before starting a second process against the same room files.
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try { $probe.Start() }
    catch { throw "Port $Port is already in use. Stop the existing local draft server (Ctrl+C in its terminal) before starting remote hosting. Saved rooms remain on disk." }
    finally { $probe.Stop() }
    $node = (Get-Command node -ErrorAction Stop).Source
    Write-Host "Starting the draft server on port $Port..."
    # Start-Process -Environment requires PowerShell 7.4. Inherit these settings
    # only for the new child, then restore this PowerShell session's environment.
    $serverEnvironment = @{ PORT = $env:PORT; HOST = $env:HOST }
    try {
        $env:PORT = "$Port"
        $env:HOST = '127.0.0.1'
        $serverProcess = Start-Process -FilePath $node -ArgumentList @('platform-design/server.cjs', '--public') -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'server.stdout.log') -RedirectStandardError (Join-Path $runtime 'server.stderr.log')
    } finally {
        [Environment]::SetEnvironmentVariable('PORT', $serverEnvironment.PORT, 'Process')
        [Environment]::SetEnvironmentVariable('HOST', $serverEnvironment.HOST, 'Process')
    }
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($serverProcess.HasExited) { throw 'Draft server exited. Check remote-host/server.stderr.log.' }
        try { $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/draft" -TimeoutSec 2; $ready = $response.StatusCode -eq 200 } catch {}
        if ($ready) { break }
        Start-Sleep -Milliseconds 250
    }
    if (!$ready) { throw 'Draft server did not become ready.' }
    Write-Host 'Connecting to Cloudflare. Waiting up to 45 seconds for your friend link...'
    $tunnelLog = Join-Path $runtime 'tunnel.stderr.log'
    $tunnelProcess = Start-Process -FilePath $tunnelFile -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Port", '--protocol', 'http2') -WorkingDirectory $runtime -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'tunnel.stdout.log') -RedirectStandardError $tunnelLog
    $publicUrl = $null
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if ($tunnelProcess.HasExited) { throw 'Cloudflare Tunnel exited. Check remote-host/tunnel.stderr.log.' }
        $logText = (Get-Content -LiteralPath $tunnelLog -Raw -ErrorAction SilentlyContinue) -join [Environment]::NewLine
        if ($logText) {
            $linkMatch = [regex]::Match($logText, 'https://[a-z0-9-]+\.trycloudflare\.com')
            if ($linkMatch.Success) { $publicUrl = $linkMatch.Value + '/draft'; break }
        }
        Start-Sleep -Milliseconds 500
    }
    if (!$publicUrl) { throw 'Cloudflare did not provide a public address within 45 seconds.' }
    @{ url = $publicUrl; processes = @(
        @{ id = $serverProcess.Id; started = $serverProcess.StartTime.ToUniversalTime().ToString('o'); path = $node },
        @{ id = $tunnelProcess.Id; started = $tunnelProcess.StartTime.ToUniversalTime().ToString('o'); path = $tunnelFile }
    ) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile
    Write-Output "Friend link: $publicUrl"
    Write-Output 'Open this same public link yourself, create a room, and send its code with the link. Keep this PC awake and online.'
    Write-Output ('Stop sharing: & "' + (Join-Path $PSScriptRoot 'stop-remote-draft.ps1') + '"')
} catch {
    if ($tunnelProcess -and !$tunnelProcess.HasExited) { $tunnelProcess.Kill() }
    if ($serverProcess -and !$serverProcess.HasExited) { $serverProcess.Kill() }
    throw
}
