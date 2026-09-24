# Install the Visual Studio 2022 Build Tools with the C++ desktop workload.
# This unlocks the MSVC linker that the Rust MSVC host and Tauri need.
$ErrorActionPreference = 'Continue'
Write-Output 'starting winget install of VS 2022 Build Tools (C++ workload) ...'
winget install `
  --id Microsoft.VisualStudio.2022.BuildTools `
  --accept-package-agreements `
  --accept-source-agreements `
  --override '--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
Write-Output "winget exit code: $LASTEXITCODE"
Write-Output '--- vswhere ---'
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -products '*' -format value -property displayName
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -products '*' -format value -property installationPath
