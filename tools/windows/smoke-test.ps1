<#
.SYNOPSIS
  Smoke-test the packaged Inkfin binary on Windows.

.DESCRIPTION
  Measures what a packaged build can be measured for from outside the app:

  * time from process start to the app window appearing with its document title
    (a proxy for "the window came up", not first paint);
  * working set and private bytes for the open process;
  * single-instance behaviour: a second launch with another file must replace the
    document in the existing process and must not open a second one;
  * the document hash before and after, so a read-only claim is checked, not
    assumed;
  * a window screenshot, when the compositor allows it.

  It does NOT install anything and does NOT touch file associations. Those need a
  clean machine and stay unverified in docs/TEST-REPORT.md.

.PARAMETER Exe
  Path to the packaged inkfin.exe (release build or an extracted install).

.PARAMETER FixtureDirectory
  Directory holding Markdown fixtures. Two files are used: the first is opened
  normally, the second is passed to a second launch.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools/windows/smoke-test.ps1 `
    -Exe src-tauri/target/release/inkfin.exe -FixtureDirectory docs/acceptance
#>

param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$FixtureDirectory,
  [string]$OutFile = 'artifacts/windows/smoke-result.json',
  [string]$ScreenshotPath = 'artifacts/windows/smoke-window.png',
  [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'

# Top-level windows owned by a process. .NET's MainWindowTitle picks whichever
# visible window it finds first, which for Tauri is the single-instance helper
# window (`com.inkfin.viewer-...`), so the windows are enumerated directly.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class InkfinWindow {
  public IntPtr Handle;
  public string Title;
}

public class InkfinWindows {
  private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  public static InkfinWindow[] VisibleWindowsOf(int pid) {
    var found = new List<InkfinWindow>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint owner;
      GetWindowThreadProcessId(hWnd, out owner);
      if (owner == (uint)pid && IsWindowVisible(hWnd)) {
        int length = GetWindowTextLength(hWnd);
        if (length > 0) {
          var buffer = new StringBuilder(length + 1);
          GetWindowText(hWnd, buffer, buffer.Capacity);
          found.Add(new InkfinWindow { Handle = hWnd, Title = buffer.ToString() });
        }
      }
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }

  public static bool Capture(IntPtr hWnd, string path) {
    RECT rect;
    if (!GetWindowRect(hWnd, out rect)) { return false; }
    int width = rect.Right - rect.Left;
    int height = rect.Bottom - rect.Top;
    if (width <= 0 || height <= 0) { return false; }

    using (var bitmap = new System.Drawing.Bitmap(width, height))
    using (var graphics = System.Drawing.Graphics.FromImage(bitmap)) {
      IntPtr hdc = graphics.GetHdc();
      // 0x2 = PW_RENDERFULLCONTENT, required for composited WebView2 content.
      bool ok = PrintWindow(hWnd, hdc, 0x2);
      graphics.ReleaseHdc(hdc);
      if (!ok) { return false; }
      bitmap.Save(path, System.Drawing.Imaging.ImageFormat.Png);
      return true;
    }
  }
}
'@ -ReferencedAssemblies System.Drawing

function Get-Sha256([string]$Path) {
  (Get-FileHash -Algorithm SHA256 -Path $Path).Hash
}

function Wait-ForWindow([System.Diagnostics.Process]$Process, [string]$Expected, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $Process.Refresh()
    if ($Process.HasExited) { return $null }
    $match = [InkfinWindows]::VisibleWindowsOf($Process.Id) |
      Where-Object { $_.Title -like "*$Expected*" } |
      Select-Object -First 1
    if ($null -ne $match) { return $match }
    Start-Sleep -Milliseconds 100
  }
  return $null
}

$exePath = (Resolve-Path -LiteralPath $Exe).Path
$fixturePath = (Resolve-Path -LiteralPath $FixtureDirectory).Path
$fixtures = Get-ChildItem -Path $fixturePath -Filter '*.md' | Sort-Object Name
if ($fixtures.Count -lt 2) {
  throw "need at least two .md fixtures in $fixturePath; found $($fixtures.Count)"
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("inkfin-smoke-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$first = Join-Path $work $fixtures[0].Name
$second = Join-Path $work $fixtures[1].Name
Copy-Item -LiteralPath $fixtures[0].FullName -Destination $first
Copy-Item -LiteralPath $fixtures[1].FullName -Destination $second

$beforeFirst = Get-Sha256 $first
$beforeSecond = Get-Sha256 $second

$result = [ordered]@{
  exe                           = $exePath
  exeSha256                     = Get-Sha256 $exePath
  fixtureDirectory              = $fixturePath
  openingDocument               = $fixtures[0].Name
  secondDocument                = $fixtures[1].Name
  windowTimeoutSeconds          = $TimeoutSeconds
  windowAppearedMilliseconds    = $null
  windowTitle                   = $null
  workingSetBytes               = $null
  privateBytes                  = $null
  secondLaunchTitle             = $null
  processCountAfterSecondLaunch = $null
  documentsUnchanged            = $null
  screenshot                    = $null
  failures                      = @()
}

$process = $null
try {
  # The window title is "<name> - Inkfin" once a document is on screen, so this
  # waits for the document, not merely for a process. The single-instance helper
  # window is titled `com.inkfin.viewer-siw` and is deliberately not matched.
  $expectedFirst = "$($fixtures[0].Name) - Inkfin"
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $process = Start-Process -FilePath $exePath -ArgumentList "`"$first`"" -PassThru
  $window = Wait-ForWindow -Process $process -Expected $expectedFirst -Seconds $TimeoutSeconds
  $watch.Stop()

  if ($null -eq $window) {
    $result.failures += 'the app window did not appear within the timeout'
  } else {
    $result.windowAppearedMilliseconds = $watch.ElapsedMilliseconds
    $result.windowTitle = $window.Title
    if ($window.Title -ne $expectedFirst) {
      $result.failures += "the window title '$($window.Title)' does not name the opened document"
    }
    $process.Refresh()
    $result.workingSetBytes = $process.WorkingSet64
    $result.privateBytes = $process.PrivateMemorySize64

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ScreenshotPath) | Out-Null
    if ([InkfinWindows]::Capture($window.Handle, (Join-Path (Get-Location) $ScreenshotPath))) {
      $result.screenshot = $ScreenshotPath
    } else {
      $result.screenshot = 'not captured (PrintWindow returned false)'
    }
  }

  # A second launch with another file: one process must keep running and must
  # switch to the new document instead of opening a second window.
  Start-Process -FilePath $exePath -ArgumentList "`"$second`"" | Out-Null
  $switched = Wait-ForWindow -Process $process -Expected "$($fixtures[1].Name) - Inkfin" -Seconds $TimeoutSeconds
  if ($null -eq $switched) {
    $result.failures += 'the second launch did not replace the open document'
  } else {
    $result.secondLaunchTitle = $switched.Title
  }

  $result.processCountAfterSecondLaunch = @(
    Get-Process -Name ([System.IO.Path]::GetFileNameWithoutExtension($exePath)) -ErrorAction SilentlyContinue
  ).Count
  if ($result.processCountAfterSecondLaunch -ne 1) {
    $result.failures += "expected exactly one process after the second launch, saw $($result.processCountAfterSecondLaunch)"
  }

  $result.documentsUnchanged = ((Get-Sha256 $first) -eq $beforeFirst) -and ((Get-Sha256 $second) -eq $beforeSecond)
  if (-not $result.documentsUnchanged) {
    $result.failures += 'a document changed on disk during the smoke test'
  }
} finally {
  if ($null -ne $process -and -not $process.HasExited) {
    $process.CloseMainWindow() | Out-Null
    Start-Sleep -Seconds 2
    if (-not $process.HasExited) { $process.Kill() }
  }
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null
$result | ConvertTo-Json -Depth 4 | Set-Content -Path $OutFile -Encoding UTF8
$result | Format-List
if ($result.failures.Count -gt 0) {
  Write-Error ("smoke test failed: " + ($result.failures -join '; '))
  exit 1
}
Write-Output 'SMOKE_OK'
