# Runs an isolated first-time Windows install of the published package and
# verifies that the installed command starts the production server.
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("larkup-release-install-" + [guid]::NewGuid())
$ServerProcess = $null

try {
    New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null
    $env:HOME = Join-Path $TestRoot 'home'
    $env:USERPROFILE = $env:HOME
    $env:APPDATA = Join-Path $TestRoot 'appdata'
    $env:LOCALAPPDATA = Join-Path $TestRoot 'localappdata'
    $env:NPM_CONFIG_CACHE = Join-Path $TestRoot 'npm-cache'
    $env:NPM_CONFIG_PREFIX = Join-Path $TestRoot 'npm-prefix'
    New-Item -ItemType Directory -Path $env:HOME, $env:APPDATA, $env:LOCALAPPDATA, $env:NPM_CONFIG_CACHE, (Join-Path $env:NPM_CONFIG_PREFIX 'bin'), (Join-Path $env:NPM_CONFIG_PREFIX 'lib') -Force | Out-Null

    & (Join-Path $ProjectRoot 'scripts/install.ps1') -NoPrompt
    if ($LASTEXITCODE -ne 0) { throw "The Windows installer exited with code $LASTEXITCODE." }

    # npm 10.9+ protects the `prefix` config key from `npm config get`, but
    # continues to honor NPM_CONFIG_PREFIX for global installs. Prefer that
    # isolated test prefix, then support npm's normal Windows default.
    $npmPrefix = @($env:NPM_CONFIG_PREFIX, (Join-Path $env:APPDATA 'npm')) |
        Where-Object { $_ -and (Test-Path (Join-Path $_ 'larkup.cmd')) } |
        Select-Object -First 1
    if (-not $npmPrefix) {
        throw 'The installer did not create larkup.cmd in a global npm bin directory.'
    }
    $env:Path = "$npmPrefix;$env:Path"
    $version = & larkup --version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^\d+\.\d+\.\d+') {
        throw 'The installed larkup command did not report a semantic version.'
    }
    Write-Host "Installed larkup $version"

    $stdoutPath = Join-Path $TestRoot 'larkup.stdout.log'
    $stderrPath = Join-Path $TestRoot 'larkup.stderr.log'
    $env:PORT = '4568'
    $ServerProcess = Start-Process -FilePath 'larkup.cmd' -ArgumentList 'start' -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4568/' -TimeoutSec 2
            if ($response.StatusCode -lt 500) {
                Write-Host 'Installed Larkup server is healthy.'
                exit 0
            }
        } catch {}
        Start-Sleep -Seconds 1
    }

    if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Tail 100 }
    if (Test-Path $stderrPath) { Get-Content $stderrPath -Tail 100 }
    throw 'Installed Larkup server did not become healthy.'
} finally {
    if ($ServerProcess -and -not $ServerProcess.HasExited) { Stop-Process -Id $ServerProcess.Id -Force }
    if (Test-Path $TestRoot) {
        # The spawned server may leave browser-cache handles briefly open on
        # GitHub's Windows runner. Cleanup must not turn a passed smoke test
        # into a failure.
        Remove-Item -Recurse -Force $TestRoot -ErrorAction SilentlyContinue
    }
}
