# Build the Windows installer.
#
# The Tauri CLI shells out to `cargo`, which is not on PATH in a plain shell
# even when rustup is installed to its default location. That produced
# "failed to run 'cargo metadata' ... program not found" with no useful hint,
# so this wrapper closes that gap instead of asking the next person to
# rediscover it.
#
# Usage:  run from the repository root, then
#         powershell -ExecutionPolicy Bypass -File tools/dev-setup/build.ps1

$ErrorActionPreference = 'Stop'

# Only $LASTEXITCODE should decide whether the build failed. Without this, a
# warning written to stderr by npm becomes a terminating error on PowerShell 7.4+
# because of $PSNativeCommandUseErrorActionPreference. The variable does not
# exist on Windows PowerShell 5.1, so it is set only when supported.
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
    throw "node_modules is missing. Run 'npm install' from $repoRoot first."
}

$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE '.cargo' }
$cargoBin = Join-Path $cargoHome 'bin'
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    if (Test-Path (Join-Path $cargoBin 'cargo.exe')) {
        $env:PATH = "$cargoBin;$env:PATH"
    }
    else {
        throw "cargo was not found on PATH, at $cargoBin, or in CARGO_HOME. Install Rust from https://rustup.rs first."
    }
}

Write-Host "cargo: $((Get-Command cargo).Source)"

Push-Location $repoRoot
try {
    npx tauri build
    if ($LASTEXITCODE -ne 0) { throw "tauri build exited with $LASTEXITCODE" }

    $installer = Join-Path $repoRoot 'src-tauri\target\release\bundle\nsis'
    $found = @(Get-ChildItem -Path $installer -Filter '*-setup.exe' -ErrorAction SilentlyContinue)

    Write-Host ''
    if ($found.Count -eq 0) {
        Write-Warning "The build reported success but no installer was found under $installer."
    }
    else {
        Write-Host 'Installer:' -ForegroundColor Green
        $found | ForEach-Object { Write-Host "  $($_.FullName)" }
    }
}
finally {
    Pop-Location
}
