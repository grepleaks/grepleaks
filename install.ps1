param(
    [string]$Repository = "",
    [string]$Ref = "main"
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
        & $python @pythonArgs $temporary --repository $Repository --ref $Ref
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
