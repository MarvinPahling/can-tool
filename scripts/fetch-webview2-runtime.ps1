# Fetches the WebView2 Fixed Version Runtime and stages it under
# src-tauri/WebView2Runtime so the NSIS bundle can embed it (webviewInstallMode
# "fixedRuntime" in tauri.conf.json). This lets the installer run on machines
# with no internet access and no WebView2 already installed, which is required
# for the offline/enterprise release bundle.
#
# The runtime is pulled from the official Microsoft.Web.WebView2 NuGet package
# (a stable, versioned source) rather than the evergreen bootstrapper, so the
# bundled runtime is pinned and reproducible across local and CI builds.

param(
	[string]$Version = "130.0.2849.68",
	[string]$Arch = "x64",
	[string]$OutDir = (Join-Path $PSScriptRoot "../src-tauri/WebView2Runtime")
)

$ErrorActionPreference = "Stop"

$OutDir = [System.IO.Path]::GetFullPath($OutDir)
$work = Join-Path ([System.IO.Path]::GetTempPath()) "webview2-fixed-$Version-$Arch"
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Path $work -Force | Out-Null

$nupkgPath = Join-Path $work "webview2.zip"
$nupkgUrl = "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$Version"

Write-Host "Downloading Microsoft.Web.WebView2 $Version..."
Invoke-WebRequest -Uri $nupkgUrl -OutFile $nupkgPath

Write-Host "Extracting NuGet package..."
Expand-Archive -Path $nupkgPath -DestinationPath $work -Force

$cabDir = Join-Path $work "runtimes/win-$Arch/nativeassets"
$cab = Get-ChildItem -Path $cabDir -Filter "Microsoft.WebView2.FixedVersionRuntime.*.cab" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $cab) {
	throw "Could not find a fixed version runtime .cab for arch '$Arch' in Microsoft.Web.WebView2 $Version"
}

if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

Write-Host "Expanding runtime cab archive..."
expand.exe $cab.FullName -F:* $OutDir | Out-Null

# The cab contains a single top-level folder named after the runtime version
# (e.g. "130.0.2849.68/..."); tauri expects the runtime files directly inside
# $OutDir, so flatten that one level if present.
$versionedDir = Get-ChildItem -Path $OutDir -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if ($versionedDir) {
	Get-ChildItem -Path $versionedDir.FullName | Move-Item -Destination $OutDir
	Remove-Item -Recurse -Force $versionedDir.FullName
}

Remove-Item -Recurse -Force $work

Write-Host "WebView2 fixed version runtime $Version ($Arch) staged at $OutDir"
