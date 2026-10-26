# Downloads the official LibreOffice MSI and extracts it (administrative extract,
# no system install) into .tools/libreoffice. Used for Office -> PDF conversion.
param([string]$Version = "26.2.6")
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
$root = Join-Path $PSScriptRoot "..\.tools" | Resolve-Path
$msi = Join-Path $root "LibreOffice_$Version.msi"
$url = "https://download.documentfoundation.org/libreoffice/stable/$Version/win/x86_64/LibreOffice_${Version}_Win_x86-64.msi"
if (-not (Test-Path $msi)) { Invoke-WebRequest -UseBasicParsing $url -OutFile $msi }
$sig = Get-AuthenticodeSignature $msi
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Document Foundation') {
  throw "MSI signature check failed: $($sig.Status) $($sig.SignerCertificate.Subject)"
}
$target = Join-Path $root "libreoffice"
New-Item -ItemType Directory -Force $target | Out-Null
$p = Start-Process msiexec.exe -ArgumentList "/a `"$msi`" /qn TARGETDIR=`"$target`"" -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "msiexec exited $($p.ExitCode)" }
Remove-Item $msi
$soffice = Get-ChildItem $target -Recurse -Filter soffice.exe | Select-Object -First 1
"OK $($soffice.FullName)"
