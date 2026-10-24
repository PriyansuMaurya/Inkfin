#Requires -Version 7.0
<## Build a Store-upload MSIX from the Tauri release executable.
    No NSIS installer, registry hooks, certificate, or bootstrapper is included.
    Windows SDK MakeAppx validates the manifest; clean-machine tests and WACK
    remain separate release gates. This script never submits to the Store.
##>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$IdentityFile,
    [string]$Executable = 'src-tauri/target/x86_64-pc-windows-msvc/release/inkfin.exe'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'MSIX packaging requires Windows with the Windows SDK.' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $repo
$identity = Get-Content -LiteralPath $IdentityFile -Raw | ConvertFrom-Json
foreach ($key in 'identityName', 'publisher', 'publisherDisplayName', 'version') {
    $value = $identity.$key
    if ([string]::IsNullOrWhiteSpace($value) -or $value -match 'COPY_|IDENTITY_REQUIRED') {
        throw "Fill $key using Product management > Product identity in Partner Center."
    }
}
if ($identity.identityName -notmatch '^[A-Za-z0-9.-]{3,50}$') { throw 'Invalid package identity name.' }
if ($identity.publisher -notmatch '^CN=') { throw 'Publisher must be the exact Partner Center distinguished name.' }
if ($identity.version -notmatch '^\d+\.\d+\.\d+\.0$') { throw 'Use a four-part Store version ending in .0.' }
$version = [version]$identity.version
if ($version.Major -lt 1 -and $version.Minor -eq 0 -and $version.Build -eq 0) { throw 'Version cannot be zero.' }
if (@($version.Major, $version.Minor, $version.Build) | Where-Object { $_ -gt 65535 }) { throw 'Version component exceeds 65535.' }
$appVersion = (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
if ("$($version.Major).$($version.Minor).$($version.Build)" -ne $appVersion) { throw 'Store version must match the app version plus .0.' }
$exe = (Resolve-Path -LiteralPath $Executable).Path
# Reject an accidentally supplied NSIS installer or wrong-architecture binary.
$bytes = [IO.File]::ReadAllBytes($exe)
$peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
if ([BitConverter]::ToUInt32($bytes, $peOffset) -ne 0x4550 -or
    [BitConverter]::ToUInt16($bytes, $peOffset + 4) -ne 0x8664) { throw 'Expected an x64 PE executable.' }
if ([Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductName -ne 'Inkfin') { throw 'Expected the Inkfin application executable, not its installer.' }
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$makeAppx = Get-ChildItem "$sdkRoot/*/x64/makeappx.exe" |
    Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1
if (-not $makeAppx) { throw 'Install the Windows SDK with MakeAppx.exe.' }
$out = Join-Path $repo 'artifacts/store'
# Each build gets a new staging directory; never delete an arbitrary supplied path.
$stage = Join-Path $out ('stage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path "$stage/Assets" -Force | Out-Null
try {
    Copy-Item -LiteralPath $exe -Destination "$stage/Inkfin.exe"
    Get-ChildItem (Join-Path (Split-Path $exe) '*.dll') | Copy-Item -Destination $stage
    Copy-Item packaging/store/assets/*.png -Destination "$stage/Assets"
    $manifest = [xml](Get-Content packaging/store/AppxManifest.xml -Raw)
    $manifest.Package.Identity.SetAttribute('Name', $identity.identityName)
    $manifest.Package.Identity.SetAttribute('Publisher', $identity.publisher)
    $manifest.Package.Identity.SetAttribute('Version', $identity.version)
    $manifest.GetElementsByTagName('PublisherDisplayName')[0].InnerText = $identity.publisherDisplayName
    $manifest.Save("$stage/AppxManifest.xml")
    $package = Join-Path $out "Inkfin_$($identity.version)_x64.msix"
    & $makeAppx.FullName pack /d $stage /p $package /o
    if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed: $LASTEXITCODE" }
    # Hash every build for traceability; unsigned is intentional for Store upload.
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $package).Hash.ToLowerInvariant()
    "$hash  $(Split-Path $package -Leaf)" | Set-Content "$package.sha256" -Encoding utf8
    Copy-Item "$stage/AppxManifest.xml" "$out/AppxManifest.xml" -Force
    Write-Host "Store-upload package: $package"
    Write-Host 'UNVERIFIED: run the MSIX acceptance checklist and WACK before submission.'
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
