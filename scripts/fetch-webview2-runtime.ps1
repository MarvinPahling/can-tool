# Fetches the WebView2 Fixed Version Runtime and stages it under
# src-tauri/WebView2Runtime so the NSIS bundle can embed it (webviewInstallMode
# "fixedRuntime" in tauri.conf.json). This lets the installer run on machines
# with no internet access and no WebView2 already installed, which is required
# for the offline/enterprise release bundle.
#
# Microsoft does not publish the fixed version runtime .cab as part of the
# Microsoft.Web.WebView2 NuGet package (that package only ships the loader
# DLL/headers) or behind any stable, scriptable URL -- the .cab is only
# available through the JS-driven download page at
# https://developer.microsoft.com/microsoft-edge/webview2/. We instead pull it
# from westinyang/WebView2RuntimeArchive, a GitHub release mirror of the same
# Microsoft-published .cab files, keyed by runtime build number, which is what
# other Tauri projects (e.g. clash-verge-rev) use in CI for the same reason.

param(
	[string]$Version = "130.0.2849.80",
	[string]$Arch = "x64",
	[string]$OutDir = (Join-Path $PSScriptRoot "../src-tauri/WebView2Runtime")
)

$ErrorActionPreference = "Stop"

$OutDir = [System.IO.Path]::GetFullPath($OutDir)
$work = Join-Path ([System.IO.Path]::GetTempPath()) "webview2-fixed-$Version-$Arch"
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Path $work -Force | Out-Null

$cabName = "Microsoft.WebView2.FixedVersionRuntime.$Version.$Arch.cab"
$cabPath = Join-Path $work $cabName
$cabUrl = "https://github.com/westinyang/WebView2RuntimeArchive/releases/download/$Version/$cabName"

Write-Host "Downloading $cabName..."
Invoke-WebRequest -Uri $cabUrl -OutFile $cabPath

if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

Write-Host "Expanding runtime cab archive..."
expand.exe $cabPath -F:* $OutDir | Out-Null

# The cab contains a single top-level folder named after the runtime version
# (e.g. "130.0.2849.80/..."); tauri expects the runtime files directly inside
# $OutDir, so flatten that one level if present.
$versionedDir = Get-ChildItem -Path $OutDir -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if ($versionedDir) {
	Get-ChildItem -Path $versionedDir.FullName | Move-Item -Destination $OutDir
	Remove-Item -Recurse -Force $versionedDir.FullName
}

Remove-Item -Recurse -Force $work

Write-Host "WebView2 fixed version runtime $Version ($Arch) staged at $OutDir"
