param(
    [string]$Repository = "",
    [string]$Ref = "main",
    [string]$Sha256 = "",
    [string]$InstallerSha256 = ""
)
$ErrorActionPreference = "Stop"
$python = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }
$pythonArgs = if ($python -eq "py") { @("-3") } else { @() }
$temporary = $null
try {
    if ($Repository) {
        if ($Repository -notmatch '^[\w.-]+/[\w.-]+$' -or $Ref -notmatch '^[\w./-]+$') {
            throw "Invalid GitHub repository or ref"
        }
        $temporary = [System.IO.Path]::GetTempFileName()
        Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/$Repository/$Ref/scripts/install.py" -OutFile $temporary
        if ($InstallerSha256) {
            $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $temporary).Hash.ToLower()
            if ($actual -ne $InstallerSha256.ToLower()) { throw "install.py checksum does not match -InstallerSha256" }
        }
        $installArgs = @("--repository", $Repository, "--ref", $Ref)
        if ($Sha256) { $installArgs += @("--sha256", $Sha256) }
        & $python @pythonArgs $temporary @installArgs
    } elseif ($PSScriptRoot) {
        & $python @pythonArgs "$PSScriptRoot/scripts/install.py" --source $PSScriptRoot
    } else {
        throw "Supply -Repository owner/repository."
    }
    if ($LASTEXITCODE -ne 0) { throw "Grepleaks installation failed." }
    $env:Path = "$env:LOCALAPPDATA\Grepleaks\bin;$env:Path"
    Write-Host "Ready. Run: grepleaks"
} finally {
    if ($temporary) { Remove-Item -LiteralPath $temporary -Force }
}
