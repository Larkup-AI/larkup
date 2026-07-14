#Requires -Version 5.1
<#
.SYNOPSIS
    Larkup — Windows/PowerShell Installer
.DESCRIPTION
    Installs Larkup CLI globally via npm on Windows.
    Usage: iwr -useb https://larkup.de/install.ps1 | iex
           powershell -c "& ([scriptblock]::Create((irm https://larkup.de/install.ps1))) -Version 1.2.0 -DryRun"
#>
param(
    [string]$Version = "latest",
    [switch]$NoPrompt,
    [switch]$DryRun,
    [switch]$VerboseOutput,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# ── Config ────────────────────────────────────────────────────
$PackageName = "@larkup/cli"
$BinName     = "larkup"
$MinNodeMajor = 18
$NodeSetupMajor = 20

# Track exit code so we don't kill the host when piped via iex
$script:ResultCode = 0

# ── Safe exit (piped iex vs script file) ──────────────────────
# When run via `iex`, calling `exit` closes the entire PowerShell
# window. Instead we throw, which iex surfaces as a red error.
function Stop-Installer {
    param([int]$Code = 1)
    $script:ResultCode = $Code
    if ($PSCommandPath) {
        exit $Code
    }
    throw "Larkup installation failed (code $Code)."
}

# ── Logging ───────────────────────────────────────────────────
function Write-Step   { param([string]$Msg) Write-Host "==> " -ForegroundColor Blue -NoNewline; Write-Host $Msg }
function Write-Ok     { param([string]$Msg) Write-Host " ✓  " -ForegroundColor Green -NoNewline; Write-Host $Msg }
function Write-Warn   { param([string]$Msg) Write-Host " !  " -ForegroundColor Yellow -NoNewline; Write-Host $Msg }
function Write-Err    { param([string]$Msg) Write-Host " ✗  " -ForegroundColor Red -NoNewline; Write-Host $Msg }
function Write-Dry    { param([string]$Msg) Write-Host "[dry-run] " -ForegroundColor Yellow -NoNewline; Write-Host $Msg }
function Write-Detail { param([string]$Msg) if ($VerboseOutput) { Write-Host "[debug] $Msg" -ForegroundColor DarkGray } }

# ── Help ──────────────────────────────────────────────────────
function Show-Help {
    Write-Host ""
    Write-Host "Larkup — Windows Installer" -ForegroundColor White
    Write-Host ""
    Write-Host "Usage:"
    Write-Host "  iwr -useb https://larkup.de/install.ps1 | iex"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Version <ver>   Install a specific version (default: latest)"
    Write-Host "  -NoPrompt        Skip interactive prompts (CI-friendly)"
    Write-Host "  -DryRun          Show what would happen without making changes"
    Write-Host "  -VerboseOutput   Enable verbose output"
    Write-Host "  -Help            Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host '  iwr -useb https://larkup.de/install.ps1 | iex'
    Write-Host '  .\install.ps1 -Version 1.2.0 -NoPrompt'
    Write-Host '  .\install.ps1 -DryRun'
    Write-Host ""
}

# ── Prompt helper ─────────────────────────────────────────────
function Request-Confirm {
    param([string]$Message = "Continue?")

    if ($DryRun -or $NoPrompt) {
        Write-Detail "Auto-confirmed: $Message"
        return $true
    }
    if (-not [Environment]::UserInteractive) {
        Write-Detail "Non-interactive session, auto-confirming: $Message"
        return $true
    }
    $reply = Read-Host "$Message (y/N)"
    return ($reply -match "^[Yy]$")
}

# ── OS + arch detection ──────────────────────────────────────
function Get-SystemArch {
    # ARM64 Windows may run PowerShell under x64 emulation,
    # so env vars alone can be wrong. Check WMI first.
    try {
        $proc = Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop | Select-Object -First 1
        if ($proc -and $proc.Architecture -eq 12) { return "arm64" }
    } catch {}

    foreach ($archVar in @($env:PROCESSOR_ARCHITEW6432, $env:PROCESSOR_ARCHITECTURE)) {
        if ($archVar -match "ARM64") { return "arm64" }
    }
    return "x64"
}

function Confirm-WindowsPlatform {
    # PowerShell Core (v6+) runs on non-Windows too
    if ($PSVersionTable.PSVersion.Major -ge 6 -and -not $IsWindows) {
        Write-Err "This installer is for Windows. Use the bash installer instead:"
        Write-Err "  curl -fsSL https://larkup.de/install.sh | bash"
        Stop-Installer
    }
    $arch = Get-SystemArch
    Write-Ok "Detected: Windows ($arch)"
}

# ── PATH helpers ─────────────────────────────────────────────
# Rebuilds $env:Path from Machine + User env vars (deduped).
function Sync-SessionPath {
    $seen = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
    $merged = New-Object System.Collections.Generic.List[string]

    $sources = @(
        [Environment]::GetEnvironmentVariable("Path", "Machine"),
        [Environment]::GetEnvironmentVariable("Path", "User"),
        $env:Path
    )
    foreach ($src in $sources) {
        foreach ($entry in @($src -split ";")) {
            if (-not [string]::IsNullOrWhiteSpace($entry) -and $seen.Add($entry)) {
                $merged.Add($entry)
            }
        }
    }
    $env:Path = $merged -join ";"
}

# Adds a directory to the current session PATH.
function Use-PathEntry {
    param([Parameter(Mandatory)]  [string]$Dir)

    $entries = @($env:Path -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($entries | Where-Object { $_ -ieq $Dir }) { return }
    $env:Path = "$Dir;$env:Path"
}

# Persists a directory to the User-level PATH (survives restarts).
function Save-PathEntry {
    param([string]$Dir)
    if (-not $Dir) { return }

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $existing = @($userPath -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($existing | Where-Object { $_ -ieq $Dir }) {
        Write-Detail "$Dir already on User PATH"
        return
    }

    if ($DryRun) {
        Write-Dry "Would add $Dir to User PATH"
        return
    }

    $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $Dir } else { "$userPath;$Dir" }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Use-PathEntry $Dir
    Write-Ok "Added $Dir to User PATH"
}

# After Node/npm install, the binary might be in Program Files
# but not yet on the process PATH. Scan common locations.
function Find-NodeInProgramFiles {
    foreach ($root in @($env:ProgramW6432, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ([string]::IsNullOrWhiteSpace($root)) { continue }
        $nodeDir = Join-Path $root "nodejs"
        if (Test-Path (Join-Path $nodeDir "node.exe")) {
            Use-PathEntry $nodeDir
            return $true
        }
    }
    return $false
}

# ── Node.js check ─────────────────────────────────────────────
function Get-NodeSemver {
    try {
        $raw = & node -v 2>$null
        if (-not $raw) { return $null }
        $ver = $raw -replace "^v", ""
        $parts = $ver.Split(".")
        if ($parts.Count -lt 3) { return $null }
        return @{
            Major = [int]$parts[0]
            Minor = [int]$parts[1]
            Patch = [int]$parts[2]
            Raw   = $raw
        }
    } catch {
        return $null
    }
}

function Assert-NodeInstalled {
    Write-Step "Checking for Node.js (>= v$MinNodeMajor)..."

    $node = Get-NodeSemver
    if ($node) {
        if ($node.Major -ge $MinNodeMajor) {
            Write-Ok "Found Node.js $($node.Raw) (meets v${MinNodeMajor}+ requirement)"
            return
        }
        Write-Warn "Found Node.js $($node.Raw), but Larkup requires v${MinNodeMajor}+."
    } else {
        Write-Warn "Node.js is not installed."
    }

    if (Request-Confirm "Install Node.js v${NodeSetupMajor}.x automatically?") {
        Install-NodeRuntime
    } else {
        Write-Err "Node.js v${MinNodeMajor}+ is required. Install from: https://nodejs.org/"
        Stop-Installer
    }
}

# ── Node.js installation ────────────────────────────────────
function Install-NodeRuntime {
    Write-Step "Installing Node.js v${NodeSetupMajor}.x..."

    if ($DryRun) {
        Write-Dry "Would download and install Node.js v${NodeSetupMajor}.x"
        return
    }

    $installed = $false

    # 1) winget (Windows 10+ with App Installer)
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Step "Installing via winget..."
        & winget install OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements --silent | Out-Host
        Sync-SessionPath
        Find-NodeInProgramFiles | Out-Null
        $installed = [bool](Get-Command node -ErrorAction SilentlyContinue)
        if ($installed) { Write-Ok "Node.js installed via winget" }
    }

    # 2) Chocolatey
    if (-not $installed -and (Get-Command choco -ErrorAction SilentlyContinue)) {
        Write-Step "Installing via Chocolatey..."
        & choco upgrade nodejs-lts -y --install-if-not-installed --no-progress | Out-Host
        Sync-SessionPath
        $installed = [bool](Get-Command node -ErrorAction SilentlyContinue)
        if ($installed) { Write-Ok "Node.js installed via Chocolatey" }
    }

    # 3) Scoop
    if (-not $installed -and (Get-Command scoop -ErrorAction SilentlyContinue)) {
        Write-Step "Installing via Scoop..."
        & scoop install nodejs-lts | Out-Host
        Sync-SessionPath
        $installed = [bool](Get-Command node -ErrorAction SilentlyContinue)
        if ($installed) { Write-Ok "Node.js installed via Scoop" }
    }

    # 4) Direct MSI download (last resort)
    if (-not $installed) {
        Write-Step "Downloading Node.js installer..."
        $arch = Get-SystemArch
        $msiUrl = "https://nodejs.org/dist/latest-v${NodeSetupMajor}.x/node-v${NodeSetupMajor}.0.0-${arch}.msi"
        $msiPath = Join-Path $env:TEMP "larkup-node-installer.msi"

        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
            Write-Step "Running installer (may require elevation)..."
            Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn" -Wait -Verb RunAs
        } finally {
            if (Test-Path $msiPath) { Remove-Item $msiPath -Force }
        }
        Sync-SessionPath
        Find-NodeInProgramFiles | Out-Null
        $installed = [bool](Get-Command node -ErrorAction SilentlyContinue)
    }

    if (-not $installed) {
        Write-Err "Node.js installation completed but 'node' not found."
        Write-Err "Restart PowerShell and try again, or install manually: https://nodejs.org/"
        Stop-Installer
    }

    # Verify version meets requirement
    $node = Get-NodeSemver
    if ($node -and $node.Major -ge $MinNodeMajor) {
        Write-Ok "Node.js $($node.Raw) installed"
    } else {
        Write-Warn "Installed Node.js but version may not meet v${MinNodeMajor}+ requirement."
        Write-Warn "Restart PowerShell and retry if you encounter issues."
    }
}

# ── npm globals setup ────────────────────────────────────────
# On Windows, npm puts .cmd shims in the prefix root (e.g. %APPDATA%\npm).
$script:NpmGlobalBin = ""

function Get-NpmPrefixDir {
    try {
        $prefix = (& npm config get prefix 2>$null)
        if ($LASTEXITCODE -eq 0 -and $prefix) {
            return $prefix.Trim()
        }
    } catch {}
    # Common fallback
    if ($env:APPDATA) { return Join-Path $env:APPDATA "npm" }
    return ""
}

function Set-NpmGlobals {
    $prefix = Get-NpmPrefixDir
    Write-Detail "npm prefix: $prefix"

    if (-not $prefix) { return }

    # npm on Windows puts .cmd shims directly in the prefix dir
    $script:NpmGlobalBin = $prefix

    if ($DryRun) {
        Write-Dry "Would ensure npm prefix on PATH: $prefix"
        return
    }

    if (-not (Test-Path $prefix)) {
        New-Item -ItemType Directory -Path $prefix -Force | Out-Null
    }

    # Persist the prefix dir to User PATH (where .cmd shims live)
    Save-PathEntry $prefix
}

# ── Existing install detection ────────────────────────────────
function Find-PriorInstall {
    try {
        $ver = & $BinName --version 2>$null
        if ($LASTEXITCODE -eq 0 -and $ver) {
            if ($Version -eq "latest") {
                Write-Step "Larkup $ver found — upgrading to latest..."
            } else {
                Write-Step "Larkup $ver found — installing v${Version}..."
            }
            return $true
        }
    } catch {}
    return $false
}

# ── Install Larkup ───────────────────────────────────────────
function Install-Larkup {
    $spec = "${PackageName}@${Version}"

    $isUpgrade = Find-PriorInstall

    Set-NpmGlobals

    Write-Step "Installing $spec..."

    if ($DryRun) {
        Write-Dry "Would run: npm install -g $spec"
        return
    }

    $logFile = Join-Path $env:TEMP "larkup-install-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

    # Suppress npm noise via env vars (restored after install)
    $prevLogLevel = $env:NPM_CONFIG_LOGLEVEL
    $prevFund     = $env:NPM_CONFIG_FUND
    $prevAudit    = $env:NPM_CONFIG_AUDIT
    $env:NPM_CONFIG_LOGLEVEL = "error"
    $env:NPM_CONFIG_FUND     = "false"
    $env:NPM_CONFIG_AUDIT    = "false"

    try {
        $npmOutput = & npm install -g $spec 2>&1
        $npmExit = $LASTEXITCODE

        # Write output to log regardless
        if ($npmOutput) { $npmOutput | Out-File -FilePath $logFile -Encoding utf8 }

        if ($npmExit -ne 0) {
            Write-Err "npm install -g failed."
            if (Test-Path $logFile) {
                Write-Warn "Install log: $logFile"
                Write-Warn "Last lines:"
                Get-Content $logFile -Tail 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
            }
            Write-Err "Re-run with -VerboseOutput for more details."
            Stop-Installer
        }

        if ($isUpgrade) {
            Write-Ok "Larkup upgraded!"
        } else {
            Write-Ok "Larkup installed!"
        }
    } finally {
        $env:NPM_CONFIG_LOGLEVEL = $prevLogLevel
        $env:NPM_CONFIG_FUND     = $prevFund
        $env:NPM_CONFIG_AUDIT    = $prevAudit
    }
}

# ── Post-install verification ─────────────────────────────────
function Confirm-Installation {
    if ($DryRun) {
        Write-Dry "Would verify '$BinName' is reachable on PATH"
        return
    }

    Sync-SessionPath

    if (Get-Command $BinName -ErrorAction SilentlyContinue) {
        $ver = & $BinName --version 2>$null
        Write-Ok "$BinName is on PATH ($ver)"
        return
    }

    # Not found — help the user
    Write-Host ""
    Write-Warn "'$BinName' installed but not found on PATH."

    if ($script:NpmGlobalBin) {
        # Check both prefix and prefix\node_modules\.bin
        $candidates = @($script:NpmGlobalBin)
        $subBin = Join-Path $script:NpmGlobalBin "node_modules\.bin"
        if (Test-Path $subBin) { $candidates += $subBin }

        $found = $candidates | Where-Object {
            (Test-Path (Join-Path $_ "$BinName.cmd")) -or
            (Test-Path (Join-Path $_ "$BinName.ps1")) -or
            (Test-Path (Join-Path $_ "$BinName.exe"))
        } | Select-Object -First 1

        if ($found) {
            Write-Step "Binary found at: $found"
            Save-PathEntry $found
        }

        Write-Step "Fix: restart your terminal (PATH was updated)"
        Write-Host ""
        Write-Host "  Or run now:" -ForegroundColor DarkGray
        Write-Host "  `$env:Path += `";$($script:NpmGlobalBin)`"" -ForegroundColor Green
    } else {
        Write-Warn "Could not determine npm global bin directory."
        Write-Step 'Run: npm config get prefix'
        Write-Step 'The binary should be in the npm prefix directory.'
    }
}

# ── Banner ────────────────────────────────────────────────────
function Show-Banner {
    Write-Host ""
    Write-Host "   __               __              " -ForegroundColor DarkGray
    Write-Host "  / /   ____ ______/ /____  ______  " -ForegroundColor DarkGray
    Write-Host " / /   / __ ``/ ___/ //_/ / / / __ \ " -ForegroundColor DarkGray
    Write-Host "/ /___/ /_/ / /  / ,< / /_/ / /_/ / " -ForegroundColor DarkGray
    Write-Host "\____/\__,_/_/  /_/|_|\__,_/ .___/  " -ForegroundColor DarkGray
    Write-Host "                          /_/       " -ForegroundColor DarkGray
    Write-Host ""
}

# ── Post-install next steps ───────────────────────────────────
function Show-NextSteps {
    Write-Host ""
    Write-Host "Get started:" -ForegroundColor White
    Write-Host "  larkup init my-rag-server" -ForegroundColor Green
    Write-Host "  cd my-rag-server" -ForegroundColor Green
    Write-Host "  larkup dev" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Docs:   https://larkup.de/docs" -ForegroundColor DarkGray
    Write-Host "  Issues: https://github.com/Larkup-AI/larkup/issues" -ForegroundColor DarkGray
    Write-Host ""
}

# ── Main ──────────────────────────────────────────────────────
function Main {
    if ($Help) { Show-Help; return }

    Show-Banner

    if ($DryRun) {
        Write-Step "Running in dry-run mode — no changes will be made."
        Write-Host ""
    }

    Confirm-WindowsPlatform
    Assert-NodeInstalled
    Install-Larkup
    Confirm-Installation
    Show-NextSteps

    Write-Ok "Done! 🚀"
}

Main
