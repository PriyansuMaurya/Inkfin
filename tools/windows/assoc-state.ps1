# Snapshot of the Markdown file associations, printed as one JSON document.
#
# The audit needs to know exactly what an installer changed and whether an
# uninstall put it back, so this reports one object per extension plus the
# ProgID keys those extensions can point at.
#
# With -Reset, values left behind by an Inkfin install/uninstall cycle are
# removed first: a default value naming a ProgID that no longer exists, and the
# `Markdown Document_backup` value the installer uses to remember the previous
# default. That gives the next audit run a baseline no earlier run disturbed.

param([switch]$Reset)

$progId = 'Markdown Document'
$backupValue = "${progId}_backup"
$extensions = @('.md', '.markdown')

if ($Reset) {
  foreach ($extension in $extensions) {
    # The provider opens keys read-only, so the default value can only be
    # deleted through a RegistryKey handle opened for writing.
    $writable = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\Classes\$extension", $true)
    if (-not $writable) { continue }

    $current = $writable.GetValue('')
    if ($current -eq $progId -and -not (Test-Path "HKCU:\Software\Classes\$progId")) {
      $writable.DeleteValue('', $false)
      Write-Host "reset: cleared the dangling default value on $extension"
    }
    if ($writable.GetValueNames() -contains $backupValue) {
      $writable.DeleteValue($backupValue, $false)
      Write-Host "reset: removed the leftover $backupValue value on $extension"
    }
    $writable.Close()
  }
}

$report = [ordered]@{ extensions = @() }

foreach ($extension in $extensions) {
  $key = "HKCU:\Software\Classes\$extension"
  $entry = [ordered]@{
    extension       = $extension
    keyExists       = Test-Path $key
    defaultValue    = $null
    values          = @()
    openWithProgIds = @()
    userChoice      = $null
  }

  if ($entry.keyExists) {
    $item = Get-Item -Path $key
    $entry.defaultValue = $item.GetValue('')
    $entry.values = @($item.GetValueNames() | Where-Object { $_ -ne '' } | Sort-Object)
    $entry.openWithProgIds = @(
      (Get-ChildItem -Path "$key\OpenWithProgids" -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty PSChildName | Sort-Object)
    )
  }

  $choice = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\UserChoice" -ErrorAction SilentlyContinue
  if ($choice) { $entry.userChoice = $choice.ProgId }

  $report.extensions += $entry
}

$report.state = [ordered]@{
  'Markdown'                = Test-Path 'HKCU:\Software\Classes\Markdown'
  'Markdown Document'       = Test-Path 'HKCU:\Software\Classes\Markdown Document'
  'Applications\inkfin.exe' = Test-Path 'HKCU:\Software\Classes\Applications\inkfin.exe'
  installDirectory          = Test-Path (Join-Path $env:LOCALAPPDATA 'Inkfin')
  uninstallEntry            = @(
    (Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
      Where-Object { $_.PSChildName -like '*Inkfin*' } |
      Select-Object -ExpandProperty PSChildName)
  )
}

$report | ConvertTo-Json -Depth 6
