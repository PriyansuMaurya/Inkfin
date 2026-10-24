#Requires -Version 5.1
<#! Test the built Store package on an ephemeral GitHub runner only.
    A throwaway certificate signs a COPY for installation. The original stays
    unsigned for Partner Center. No signing key/certificate is uploaded.
    This is not a clean Windows 11 desktop acceptance or accessibility test.
!#>
param([Parameter(Mandatory)][string]$PackageDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTIONS -ne 'true') {
    throw 'This script changes certificate trust and is restricted to disposable GitHub Windows runners.'
}
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $repo
$out = Join-Path $repo 'artifacts/store-validation'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$identity = Get-Content packaging/store/identity.json -Raw | ConvertFrom-Json
$packages = @(Get-ChildItem -LiteralPath $PackageDirectory -Filter '*.msix')
if ($packages.Count -ne 1) { throw 'Expected exactly one Store MSIX.' }
$package = $packages[0].FullName
$originalHash = (Get-FileHash $package -Algorithm SHA256).Hash
$expected = ((Get-Content "$package.sha256" -Raw).Trim() -split '\s+')[0]
if ($originalHash -ine $expected) { throw 'Downloaded package does not match its build checksum.' }
if (Get-AppxPackage -Name $identity.identityName) { throw 'Runner already has this package; refusing to change it.' }
$sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$signTool = Get-ChildItem "$sdk/*/x64/signtool.exe" |
    Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1
if (-not $signTool) { throw 'SignTool is not installed.' }
$cert = $null
$installed = $null
$testCopy = Join-Path $env:RUNNER_TEMP 'Inkfin-test-only.msix'
$publicCert = Join-Path $env:RUNNER_TEMP 'Inkfin-test-only.cer'
$evidence = [ordered]@{
    sourceRun = '40123888589'
    packageSha256 = $originalHash.ToLowerInvariant()
    runnerOS = (Get-CimInstance Win32_OperatingSystem).Caption
    osVersion = [Environment]::OSVersion.Version.ToString()
    installation = 'NOT RUN'
    rendering = 'NOT RUN'
    nativeWindow = 'NOT RUN'
    uninstall = 'NOT RUN'
    originalUnsignedPackageUnchanged = $false
    cleanWindows11Acceptance = 'NOT RUN: this is a GitHub Windows Server runner'
    fileAssociationShellActivation = 'NOT RUN'
    wack = 'NOT RUN'
    error = $null
}
try {
    $runtimePaths = @(
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    )
    $runtime = @($runtimePaths | ForEach-Object { Get-ItemProperty -LiteralPath $_ -Name pv -ErrorAction SilentlyContinue })
    $evidence.webview2BeforeTest = @($runtime | ForEach-Object { $_.pv })
    if ($runtime.Count -eq 0) {
        # Windows Server need not include the runtime supplied with Windows 11.
        # Provision the documented Microsoft dependency only on this disposable runner.
        $runtimeInstaller = Join-Path $env:RUNNER_TEMP 'WebView2StandaloneInstaller.exe'
        Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -UseBasicParsing -OutFile $runtimeInstaller
        $signature = Get-AuthenticodeSignature -LiteralPath $runtimeInstaller
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
            throw 'WebView2 dependency installer failed Microsoft signature validation.'
        }
        $setup = Start-Process -FilePath $runtimeInstaller -ArgumentList '/silent', '/install' -Wait -PassThru
        if ($setup.ExitCode -ne 0) { throw "WebView2 dependency setup failed: $($setup.ExitCode)" }
        Remove-Item -LiteralPath $runtimeInstaller -Force
        $evidence.webview2Provisioned = $true
    }
    Copy-Item -LiteralPath $package -Destination $testCopy -Force
    $cert = New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature `
        -Subject $identity.publisher -CertStoreLocation 'Cert:\CurrentUser\My' `
        -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}') `
        -FriendlyName 'Disposable Inkfin CI test certificate'
    Export-Certificate -Cert $cert -FilePath $publicCert | Out-Null
    Import-Certificate -FilePath $publicCert -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
    & $signTool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint /s My $testCopy
    if ($LASTEXITCODE -ne 0) { throw 'Test-copy signing failed.' }
    Add-AppxPackage -Path $testCopy -ErrorAction Stop
    $installed = Get-AppxPackage -Name $identity.identityName
    if (-not $installed) { throw 'Installed package was not registered.' }
    $evidence.installation = 'PASS'
    $evidence.packageFullName = $installed.PackageFullName
    $exe = Join-Path $installed.InstallLocation 'Inkfin.exe'
    if (-not (Test-Path -LiteralPath $exe)) { throw 'Installed application executable is missing.' }
    & powershell.exe -NoProfile -File tools/windows/smoke-test.ps1 -Exe $exe -FixtureDirectory docs/acceptance -OutFile "$out/native-smoke.json" -ScreenshotPath "$out/native-window.png"
    if ($LASTEXITCODE -ne 0) { throw 'Installed native-window smoke test failed; inspect native-smoke.json.' }
    $evidence.nativeWindow = 'PASS'
    # Exercise the executable from the installed package rather than target/release.
    # The existing probe checks real WebView2 output, local images, inert HTML,
    # blocked remote images, ordinary saves, long documents and read-only bytes.
    & node tools/windows/render-probe.mjs $exe "$out/render-probe.json"
    $evidence.rendering = if ($LASTEXITCODE -eq 0) { 'PASS' } else { 'FAIL: inspect render-probe.json; no rendering pass is claimed' }
    $wack = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/App Certification Kit/appcert.exe'
    if (-not (Test-Path -LiteralPath $wack)) {
        $evidence.wack = 'NOT AVAILABLE: Windows App Certification Kit is absent on this runner'
    } elseif ([Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) {
        $evidence.wack = 'NOT RUN: WACK requires an active user session, not Session 0'
    } else {
        & $wack reset
        $proc = Start-Process -FilePath $wack -ArgumentList @('test', '-packagefullname', $installed.PackageFullName, '-reportoutputpath', "$out/wack.xml") -PassThru
        if (-not $proc.WaitForExit(600000)) {
            $proc.Kill()
            $evidence.wack = 'TIMED OUT: review required'
        } else {
            $evidence.wack = "COMPLETED: exit $($proc.ExitCode); review wack.xml before claiming a pass"
        }
    }
} catch {
    $evidence.error = $_.Exception.Message
    throw
} finally {
    if ($installed) {
        Get-Process inkfin -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        try {
            Remove-AppxPackage -Package $installed.PackageFullName -ErrorAction Stop
            $evidence.uninstall = if (Get-AppxPackage -Name $identity.identityName) { 'FAIL' } else { 'PASS' }
        } catch { $evidence.uninstall = "FAIL: $($_.Exception.Message)" }
    }
    if ($cert) {
        foreach ($store in 'Cert:\LocalMachine\TrustedPeople', 'Cert:\CurrentUser\My') {
            Remove-Item -LiteralPath "$store\$($cert.Thumbprint)" -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath $testCopy, $publicCert -Force -ErrorAction SilentlyContinue
    $evidence.originalUnsignedPackageUnchanged = ((Get-FileHash $package -Algorithm SHA256).Hash -eq $originalHash)
    $evidence | ConvertTo-Json -Depth 5 | Set-Content "$out/msix-validation.json"
}
if ($evidence.rendering -ne 'PASS') { throw 'Rendering validation remains unresolved; inspect captured evidence.' }
if ($evidence.uninstall -ne 'PASS' -or -not $evidence.originalUnsignedPackageUnchanged) {
    throw 'Package removal or original-byte preservation failed; review msix-validation.json.'
}
