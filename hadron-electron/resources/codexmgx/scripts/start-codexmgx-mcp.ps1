param(
    [switch]$PrintConfigInfo
)

$ErrorActionPreference = "Stop"

function Add-CandidatePath {
    param(
        [System.Collections.Generic.List[string]]$Paths,
        [Parameter()]
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }

    $trimmed = $Path.Trim()
    if (-not $Paths.Contains($trimmed)) {
        $Paths.Add($trimmed)
    }
}

function Get-UserHomePath {
    if (-not [string]::IsNullOrWhiteSpace($HOME)) {
        return $HOME
    }

    return [Environment]::GetFolderPath("UserProfile")
}

function Get-AtlassianEnvFileCandidates {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptDir
    )

    $paths = New-Object 'System.Collections.Generic.List[string]'
    $homeDir = Get-UserHomePath
    $pluginRoot = Split-Path -Parent $ScriptDir
    $projectRoot = Split-Path -Parent (Split-Path -Parent $pluginRoot)

    Add-CandidatePath -Paths $paths -Path $env:ATLASSIAN_PLUGIN_ENV_FILE
    Add-CandidatePath -Paths $paths -Path $env:CODEXMGX_PLUGIN_ENV_FILE

    if (-not [string]::IsNullOrWhiteSpace($homeDir)) {
        Add-CandidatePath -Paths $paths -Path (Join-Path $homeDir ".codex\plugins\codexmgx-plugin\codexmgx-env.ps1")
        Add-CandidatePath -Paths $paths -Path (Join-Path $homeDir ".codex\codexmgx-env.ps1")
    }

    Add-CandidatePath -Paths $paths -Path (Join-Path $projectRoot "config\codexmgx-env.ps1")

    return $paths
}

function Resolve-AtlassianEnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptDir
    )

    $candidates = Get-AtlassianEnvFileCandidates -ScriptDir $ScriptDir
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return $null
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Resolve-AtlassianEnvFile -ScriptDir $scriptDir

if ($PrintConfigInfo) {
    $candidates = Get-AtlassianEnvFileCandidates -ScriptDir $scriptDir
    if ($envFile) {
        Write-Output "Resolved Atlassian config: $envFile"
    }
    else {
        Write-Output "No Atlassian config file found."
        Write-Output "Checked:"
        foreach ($candidate in $candidates) {
            Write-Output "- $candidate"
        }
        Write-Output "The plugin can also run from environment variables if they are already set."
    }

    exit 0
}

if ($envFile) {
    . $envFile
}

$serverScript = Join-Path $scriptDir "codexmgx-mcp-server.ps1"
& $serverScript
