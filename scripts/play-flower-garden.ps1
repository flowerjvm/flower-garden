[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$ExitAfterReady,
    [ValidateRange(30, 600)]
    [int]$StartupTimeoutSeconds = 180
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$rootDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDirectory = Join-Path $rootDirectory "runtime"
$mavenWrapper = Join-Path $runtimeDirectory "mvnw.cmd"
$worldUrl = "http://127.0.0.1:3000/"
$runtimeUrl = "http://127.0.0.1:8080"
$sessionDirectory = Join-Path $rootDirectory ".flower-garden"
$logDirectory = Join-Path $sessionDirectory "logs"
$ownedProcesses = New-Object System.Collections.ArrayList
$logFiles = New-Object System.Collections.ArrayList

function Write-Step {
    param([string]$Message)
    Write-Host "[Flower Garden] $Message" -ForegroundColor Green
}

function Test-TcpPort {
    param([int]$Port)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connection = $client.ConnectAsync("127.0.0.1", $Port)
        if (-not $connection.Wait(300)) {
            return $false
        }
        return $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Test-FlowerRuntime {
    try {
        $response = Invoke-WebRequest `
            -UseBasicParsing `
            -Method Post `
            -Uri "$runtimeUrl/api/v1/worlds/verdant-signal-garden/runs" `
            -ContentType "application/json" `
            -Body "{}" `
            -TimeoutSec 2
        $run = $response.Content | ConvertFrom-Json
        return (
            $response.StatusCode -eq 200 -and
            $run.worldId -eq "verdant-signal-garden" -and
            $run.flowerRuntimeVersion -eq "0.1.1"
        )
    }
    catch {
        return $false
    }
}

function Test-GardenWeb {
    try {
        $response = Invoke-WebRequest `
            -UseBasicParsing `
            -Uri $worldUrl `
            -TimeoutSec 2
        return (
            $response.StatusCode -eq 200 -and
            $response.Content.Contains("CHOOSE A WORLD") -and
            $response.Content.Contains("/worlds/first-bloom-meadow") -and
            $response.Content.Contains("/worlds/verdant-signal-garden")
        )
    }
    catch {
        return $false
    }
}

function Invoke-RuntimePost {
    param(
        [string]$Path,
        [object]$Body
    )

    $response = Invoke-WebRequest `
        -UseBasicParsing `
        -Method Post `
        -Uri "$runtimeUrl$Path" `
        -ContentType "application/json" `
        -Body ($Body | ConvertTo-Json -Depth 8 -Compress) `
        -TimeoutSec 5
    if ($response.StatusCode -ne 200) {
        throw "Flower Runtime returned HTTP $($response.StatusCode) for $Path."
    }
    return $response.Content | ConvertFrom-Json
}

function Assert-LiveVerdantMission {
    Write-Step "Proving one real Signal + Timeout Flower execution..."
    $run = Invoke-RuntimePost `
        -Path "/api/v1/worlds/verdant-signal-garden/runs" `
        -Body @{}

    $commands = @(
        @{ kind = "TICK"; payload = @{} },
        @{ kind = "ADVANCE_TIME"; payload = @{ millis = 30000 } },
        @{ kind = "SEND_SIGNAL"; payload = @{ name = "yard-assignment" } },
        @{ kind = "TICK"; payload = @{} },
        @{ kind = "TICK"; payload = @{} }
    )

    foreach ($command in $commands) {
        $lastEvent = $run.events | Select-Object -Last 1
        $run = Invoke-RuntimePost `
            -Path "/api/v1/runs/$($run.runId)/commands" `
            -Body @{
                schemaVersion = "1.0.0"
                commandId = [Guid]::NewGuid().ToString()
                runId = $run.runId
                expectedSequence = [long]$lastEvent.sequence
                kind = $command.kind
                payload = $command.payload
            }
    }

    $decision = $run.events |
        Where-Object { $_.kind -eq "VERDANT.WAIT_DECIDED" } |
        Select-Object -Last 1
    $timeoutRejected = $run.events |
        Where-Object { $_.kind -eq "VERDANT.TIMEOUT_REJECTED" } |
        Select-Object -Last 1

    if (
        $run.flowerRuntimeVersion -ne "0.1.1" -or
        $run.phase -ne "FINISHED" -or
        $run.outcome.status -ne "COMPLETED" -or
        $run.outcome.finalState -ne "SIGNALED" -or
        [int]$run.outcome.workerTicks -ne 3 -or
        $null -eq $decision -or
        $decision.payload.winner -ne "SIGNAL" -or
        $decision.payload.signalPresent -ne $true -or
        $decision.payload.timedOut -ne $true -or
        $null -eq $timeoutRejected
    ) {
        throw "The live Flower mission returned an unexpected result."
    }
}

function Wait-ForProbe {
    param(
        [string]$Name,
        [scriptblock]$Probe,
        [System.Diagnostics.Process]$Process
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (& $Probe) {
            Write-Step "$Name is ready."
            return
        }

        if ($null -ne $Process) {
            $Process.Refresh()
            if ($Process.HasExited) {
                throw "$Name stopped during startup (exit code $($Process.ExitCode))."
            }
        }

        Start-Sleep -Milliseconds 500
    }

    throw "$Name did not become ready within $StartupTimeoutSeconds seconds."
}

function Wait-ForExistingProbe {
    param(
        [string]$Name,
        [scriptblock]$Probe
    )

    Write-Step "Port is already open; checking $Name..."
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (& $Probe) {
            Write-Step "$Name is already running."
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Assert-Node {
    $node = Get-Command "node.exe" -ErrorAction SilentlyContinue
    $npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
    if ($null -eq $node -or $null -eq $npm) {
        throw "Node.js 22.13 or newer is required. Install Node.js, then double-click PLAY.cmd again."
    }

    $rawVersion = & $node.Source -p "process.versions.node"
    if ($LASTEXITCODE -ne 0) {
        throw "Node.js could not report its version."
    }
    $nodeVersion = [Version]$rawVersion.Trim()
    if ($nodeVersion -lt [Version]"22.13.0") {
        throw "Node.js 22.13 or newer is required; found $nodeVersion."
    }
    return $npm
}

function Assert-Java {
    $java = Get-Command "java.exe" -ErrorAction SilentlyContinue
    $javaHomeExecutable = $null
    if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
        $javaHomeExecutable = Join-Path $env:JAVA_HOME "bin\java.exe"
    }

    if ($null -eq $java -and (
        $null -eq $javaHomeExecutable -or
        -not (Test-Path -LiteralPath $javaHomeExecutable)
    )) {
        throw "Java 17 or newer is required. Install a JDK, then double-click PLAY.cmd again."
    }

    $javaExecutable = $javaHomeExecutable
    if ($null -eq $javaExecutable -or -not (Test-Path -LiteralPath $javaExecutable)) {
        $javaExecutable = $java.Source
    }

    $previousErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $versionOutput = (& $javaExecutable -version 2>&1) -join " "
        $javaExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorPreference
    }
    if ($javaExitCode -ne 0 -or $versionOutput -notmatch 'version "(?:1\.)?([0-9]+)') {
        throw "The installed Java version could not be verified."
    }
    $javaMajor = [int]$Matches[1]
    if ($javaMajor -lt 17) {
        throw "Java 17 or newer is required; found Java $javaMajor."
    }

    $javac = Get-Command "javac.exe" -ErrorAction SilentlyContinue
    $javaHomeCompiler = $null
    if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
        $javaHomeCompiler = Join-Path $env:JAVA_HOME "bin\javac.exe"
    }
    if ($null -eq $javac -and (
        $null -eq $javaHomeCompiler -or
        -not (Test-Path -LiteralPath $javaHomeCompiler)
    )) {
        throw "A Java 17+ JDK is required (javac is missing)."
    }

    if (-not (Test-Path -LiteralPath $mavenWrapper)) {
        throw "The bundled Maven launcher is missing: $mavenWrapper"
    }
}

function Install-WebDependencies {
    param([System.Management.Automation.ApplicationInfo]$Npm)

    $packageLock = Join-Path $rootDirectory "package-lock.json"
    $installedLock = Join-Path $rootDirectory "node_modules\.package-lock.json"
    $lockHashFile = Join-Path $sessionDirectory "package-lock.sha256"
    $currentLockHash = (Get-FileHash -LiteralPath $packageLock -Algorithm SHA256).Hash
    $installedLockHash = ""
    if (Test-Path -LiteralPath $lockHashFile) {
        $installedLockHash = (Get-Content -LiteralPath $lockHashFile -Raw).Trim()
    }
    $vinextExecutable = Join-Path $rootDirectory "node_modules\.bin\vinext.cmd"
    $needsInstall = (
        -not (Test-Path -LiteralPath $installedLock) -or
        -not (Test-Path -LiteralPath $vinextExecutable) -or
        $installedLockHash -ne $currentLockHash
    )

    if (-not $needsInstall) {
        return
    }

    Write-Step "Preparing web dependencies (first launch only)..."
    & $Npm.Source "ci" "--no-audit" "--no-fund"
    if ($LASTEXITCODE -ne 0) {
        throw "npm ci failed with exit code $LASTEXITCODE."
    }
    Set-Content `
        -LiteralPath $lockHashFile `
        -Value $currentLockHash `
        -Encoding Ascii `
        -NoNewline
}

function Build-WebIfNeeded {
    param([System.Management.Automation.ApplicationInfo]$Npm)

    $buildEntry = Join-Path $rootDirectory "dist\server\index.js"
    $sourceFiles = New-Object System.Collections.ArrayList
    foreach ($directoryName in @("app", "contracts", "public", "web", "worlds")) {
        $directory = Join-Path $rootDirectory $directoryName
        if (Test-Path -LiteralPath $directory) {
            Get-ChildItem -LiteralPath $directory -Recurse -File |
                ForEach-Object { [void]$sourceFiles.Add($_) }
        }
    }
    foreach ($fileName in @(
        "next.config.ts",
        "package.json",
        "package-lock.json",
        "postcss.config.mjs",
        "tsconfig.json",
        "vite.config.ts"
    )) {
        $file = Join-Path $rootDirectory $fileName
        if (Test-Path -LiteralPath $file) {
            [void]$sourceFiles.Add((Get-Item -LiteralPath $file))
        }
    }

    $needsBuild = -not (Test-Path -LiteralPath $buildEntry)
    if (-not $needsBuild -and $sourceFiles.Count -gt 0) {
        $latestSource = $sourceFiles |
            Sort-Object LastWriteTimeUtc -Descending |
            Select-Object -First 1
        $needsBuild = (
            $latestSource.LastWriteTimeUtc -gt
            (Get-Item -LiteralPath $buildEntry).LastWriteTimeUtc
        )
    }

    if (-not $needsBuild) {
        return
    }

    Write-Step "Building the 3D garden (first launch or source update)..."
    & $Npm.Source "run" "build"
    if ($LASTEXITCODE -ne 0) {
        throw "The Flower Garden production build failed with exit code $LASTEXITCODE."
    }
}

function Start-LoggedProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory
    )

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $standardOutput = Join-Path $logDirectory "$Name-$stamp.out.log"
    $standardError = Join-Path $logDirectory "$Name-$stamp.err.log"
    [void]$logFiles.Add($standardOutput)
    [void]$logFiles.Add($standardError)

    $process = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $standardOutput `
        -RedirectStandardError $standardError `
        -WindowStyle Hidden `
        -PassThru
    [void]$ownedProcesses.Add($process)
    return $process
}

function Stop-ProcessTree {
    param([int]$RootProcessId)

    $children = @(
        Get-CimInstance Win32_Process `
            -Filter "ParentProcessId = $RootProcessId" `
            -ErrorAction SilentlyContinue
    )
    foreach ($child in $children) {
        Stop-ProcessTree -RootProcessId ([int]$child.ProcessId)
    }

    Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
}

function Stop-OwnedProcesses {
    if ($ownedProcesses.Count -eq 0) {
        return
    }

    Write-Step "Stopping services started by this launcher..."
    for ($index = $ownedProcesses.Count - 1; $index -ge 0; $index--) {
        $process = $ownedProcesses[$index]
        $process.Refresh()
        if (-not $process.HasExited) {
            Stop-ProcessTree -RootProcessId $process.Id
        }
    }
}

function Show-LogTail {
    foreach ($logFile in $logFiles) {
        if (-not (Test-Path -LiteralPath $logFile)) {
            continue
        }
        $content = @(Get-Content -LiteralPath $logFile -Tail 18)
        if ($content.Count -eq 0) {
            continue
        }

        Write-Host ""
        Write-Host "--- $logFile ---" -ForegroundColor DarkGray
        $content | ForEach-Object { Write-Host $_ }
    }
}

$failed = $false

try {
    Set-Location $rootDirectory
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

    Write-Host ""
    Write-Host "========================================" -ForegroundColor DarkGreen
    Write-Host "         FLOWER GARDEN - PLAY" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor DarkGreen
    Write-Host ""

    $runtimeProcess = $null
    $webProcess = $null

    $runtimePortOpen = Test-TcpPort -Port 8080
    $runtimeReady = $false
    if ($runtimePortOpen) {
        $runtimeReady = Wait-ForExistingProbe `
            -Name "actual Flower Runtime" `
            -Probe ${function:Test-FlowerRuntime}
        if (-not $runtimeReady) {
            throw "Port 8080 is used by another application. Close it and run PLAY.cmd again."
        }
    }

    $webPortOpen = Test-TcpPort -Port 3000
    $webReady = $false
    if ($webPortOpen) {
        $webReady = Wait-ForExistingProbe `
            -Name "Flower Garden web" `
            -Probe ${function:Test-GardenWeb}
        if (-not $webReady) {
            throw "Port 3000 is used by another application. Close it and run PLAY.cmd again."
        }
    }

    if (-not $runtimeReady) {
        Assert-Java
        Write-Step "Starting the actual Flower 0.1.1 Runtime..."
        $hadServerAddress = Test-Path Env:\SERVER_ADDRESS
        $previousServerAddress = $env:SERVER_ADDRESS
        $env:SERVER_ADDRESS = "127.0.0.1"
        try {
            $runtimeProcess = Start-LoggedProcess `
                -Name "runtime" `
                -FilePath $mavenWrapper `
                -ArgumentList @("-q", "spring-boot:run") `
                -WorkingDirectory $runtimeDirectory
        }
        finally {
            if ($hadServerAddress) {
                $env:SERVER_ADDRESS = $previousServerAddress
            }
            else {
                Remove-Item Env:\SERVER_ADDRESS -ErrorAction SilentlyContinue
            }
        }
    }

    if (-not $webReady) {
        $hadRuntimeUrl = Test-Path Env:\NEXT_PUBLIC_FLOWER_RUNTIME_URL
        $previousRuntimeUrl = $env:NEXT_PUBLIC_FLOWER_RUNTIME_URL
        $env:NEXT_PUBLIC_FLOWER_RUNTIME_URL = $runtimeUrl
        try {
            $npm = Assert-Node
            Install-WebDependencies -Npm $npm
            Build-WebIfNeeded -Npm $npm

            Write-Step "Starting the 3D garden..."
            $webProcess = Start-LoggedProcess `
                -Name "web" `
                -FilePath $npm.Source `
                -ArgumentList @(
                    "run",
                    "start",
                    "--",
                    "--hostname",
                    "127.0.0.1",
                    "--port",
                    "3000"
                ) `
                -WorkingDirectory $rootDirectory
        }
        finally {
            if ($hadRuntimeUrl) {
                $env:NEXT_PUBLIC_FLOWER_RUNTIME_URL = $previousRuntimeUrl
            }
            else {
                Remove-Item Env:\NEXT_PUBLIC_FLOWER_RUNTIME_URL -ErrorAction SilentlyContinue
            }
        }
    }

    if (-not $runtimeReady) {
        Wait-ForProbe `
            -Name "Actual Flower Runtime" `
            -Probe ${function:Test-FlowerRuntime} `
            -Process $runtimeProcess
    }
    if (-not $webReady) {
        Wait-ForProbe `
            -Name "3D garden" `
            -Probe ${function:Test-GardenWeb} `
            -Process $webProcess
    }

    Write-Host ""
    Write-Host "READY: Flower Garden World Select" -ForegroundColor Green
    Write-Host $worldUrl -ForegroundColor Cyan
    Write-Host "Mode: LIVE - actual Flower Runtime" -ForegroundColor Green
    Write-Host ""

    if (-not $NoBrowser) {
        try {
            Start-Process $worldUrl
        }
        catch {
            Write-Host "Open the URL above in your browser." -ForegroundColor Yellow
        }
    }

    if ($ExitAfterReady) {
        Assert-LiveVerdantMission
        Write-Step "Startup smoke check passed."
    }
    elseif ($ownedProcesses.Count -gt 0) {
        Write-Host "Keep this window open while playing." -ForegroundColor Yellow
        [void](Read-Host "Press ENTER to stop Flower Garden")
    }
}
catch {
    $failed = $true
    Write-Host ""
    Write-Host "START FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Show-LogTail
}
finally {
    Stop-OwnedProcesses
}

if ($failed) {
    if (-not $ExitAfterReady) {
        [void](Read-Host "Press ENTER to close")
    }
    exit 1
}
exit 0
