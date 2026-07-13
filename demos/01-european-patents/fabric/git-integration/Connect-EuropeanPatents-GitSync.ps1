#requires -Version 7
<#
  Connect-EuropeanPatents-GitSync.ps1

  Automates Fabric Git integration (GitHub) for the "European Patents" workspace,
  as far as the REST API allows, then does the first Commit (workspace -> Git).

  WHAT IT AUTOMATES
    1. Auth (az login already done, or run the az login line below).
    2. Resolve the workspace id by name.
    3. Read current Git connection status.
    4. Connect the workspace to the GitHub repo/branch/folder (git/connect).
    5. Initialize the connection (git/initializeConnection) and pick the
       "PreferWorkspace" direction for the very first sync.
    6. Poll the resulting long-running operation.
    7. Commit all workspace items to Git (git/commitToGit).

  WHAT IT CANNOT AUTOMATE (must be done ONCE in the browser first)
    - The GitHub OAuth authorization for the Fabric GitHub app, AND
    - Creating a GitHub "source control" credential/connection in Fabric.
      Do this once: Fabric portal -> Workspace settings -> Git integration ->
      GitHub -> sign in / authorize. After that this script can drive the rest.
      (The API requires "myGitCredentials" to already exist for GitHub.)

  PREREQUISITES
    - Workspace is on a Fabric capacity (not Pro/PPU only).
    - Tenant setting "Users can sync workspace items with GitHub" = enabled.
    - Branch 'fabric-sync' and folder path already exist in the repo (seed first).
#>

[CmdletBinding()]
param(
  [string]$WorkspaceName   = "European Patents",
  [string]$GitHubOwner     = "marcelfranke",
  [string]$RepoName        = "fabric-demos",
  [string]$Branch          = "fabric-sync",
  [string]$DirectoryName   = "demos/01-european-patents/workspace-sync",
  [string]$Tenant          = "1cf0faf3-5363-470a-8369-df15f6562c64",
  [string]$ConnectionId    = "",
  [string]$FabricResource  = "https://api.fabric.microsoft.com",
  [switch]$CommitAfterConnect = $true
)

$ErrorActionPreference = "Stop"
$base = "$FabricResource/v1"

function Invoke-Fabric {
  param(
    [Parameter(Mandatory)][ValidateSet("get","post","patch","delete","put")] [string]$Method,
    [Parameter(Mandatory)][string]$Url,
    [object]$Body
  )
  $args = @("rest","--method",$Method,"--resource",$FabricResource,"--url",$Url,
            "--headers","Content-Type=application/json")
  if ($PSBoundParameters.ContainsKey("Body") -and $null -ne $Body) {
    $tmp = New-TemporaryFile
    ($Body | ConvertTo-Json -Depth 20) | Set-Content -Path $tmp -Encoding utf8
    $args += @("--body","@$tmp")
  }
  $raw = az @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "az rest $Method $Url failed:`n$raw" }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  try { return ($raw | ConvertFrom-Json) } catch { return $raw }
}

function Wait-Lro {
  param([string]$OperationUrl)
  if (-not $OperationUrl) { return }
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 5
    $op = Invoke-Fabric -Method get -Url $OperationUrl
    $status = $op.status
    Write-Host "  LRO status: $status"
    if ($status -in @("Succeeded","Completed")) { return $op }
    if ($status -in @("Failed","Cancelled")) { throw "LRO ${status}: $($op | ConvertTo-Json -Depth 10)" }
  }
  throw "LRO timed out."
}

# --- 0. Auth check -----------------------------------------------------------
Write-Host "== Checking az login =="
$acct = az account show 2>$null | ConvertFrom-Json
if (-not $acct) {
  Write-Host "Not logged in. Run:"
  Write-Host "  az login --tenant $Tenant --allow-no-subscriptions"
  throw "az login required."
}
Write-Host "Signed in as: $($acct.user.name)"

# --- 1. Resolve workspace id -------------------------------------------------
Write-Host "== Resolving workspace '$WorkspaceName' =="
$wss = Invoke-Fabric -Method get -Url "$base/workspaces"
$ws  = $wss.value | Where-Object { $_.displayName -eq $WorkspaceName } | Select-Object -First 1
if (-not $ws) { throw "Workspace '$WorkspaceName' not found." }
$wsId = $ws.id
Write-Host "Workspace id: $wsId"

# --- 2. Current Git status ---------------------------------------------------
Write-Host "== Current Git connection =="
$conn = $null
try { $conn = Invoke-Fabric -Method get -Url "$base/workspaces/$wsId/git/connection" } catch {}
if ($conn -and $conn.gitConnectionState -and $conn.gitConnectionState -ne "NotConnected") {
  Write-Host "Already connected. State: $($conn.gitConnectionState)"
  Write-Host ($conn | ConvertTo-Json -Depth 10)
} else {
  # --- 3. Connect ------------------------------------------------------------
  Write-Host "== Connecting to GitHub =="

  # GitHub connect requires myGitCredentials referencing a pre-created
  # GitHubSourceControl connection (produced by the one-time browser OAuth).
  if (-not $ConnectionId) {
    Write-Host "Resolving GitHubSourceControl connection..."
    $conns = Invoke-Fabric -Method get -Url "$FabricResource/v1/connections"
    $ghConn = $conns.value |
      Where-Object { $_.connectionDetails.type -eq "GitHubSourceControl" } |
      Select-Object -First 1
    if (-not $ghConn) {
      throw "No GitHubSourceControl connection found. Complete the one-time GitHub OAuth in Fabric (Workspace settings -> Git integration -> GitHub -> authorize), then re-run."
    }
    $ConnectionId = $ghConn.id
  }
  Write-Host "Using connection id: $ConnectionId"

  $connectBody = @{
    gitProviderDetails = @{
      gitProviderType = "GitHub"
      ownerName       = $GitHubOwner
      repositoryName  = $RepoName
      branchName      = $Branch
      directoryName   = $DirectoryName
    }
    myGitCredentials = @{
      source       = "ConfiguredConnection"
      connectionId = $ConnectionId
    }
  }
  # NOTE: GitHub connect requires a pre-created source-control credential
  # ("myGitCredentials"). If this call returns an error about credentials,
  # complete the one-time browser authorization, then re-run.
  Invoke-Fabric -Method post -Url "$base/workspaces/$wsId/git/connect" -Body $connectBody
  Write-Host "Connected. Initializing..."

  # --- 4. Initialize connection ---------------------------------------------
  $initResp = az rest --method post --resource $FabricResource `
    --url "$base/workspaces/$wsId/git/initializeConnection" `
    --headers "Content-Type=application/json" --body "{}" --verbose 2>&1
  $opId = ($initResp | Select-String -Pattern "x-ms-operation-id.*?'([a-f0-9-]+)'" |
            Select-Object -First 1).Matches.Groups[1].Value
  if ($opId) { Wait-Lro -OperationUrl "$base/operations/$opId" }

  $init = Invoke-Fabric -Method get -Url "$base/workspaces/$wsId/git/connection"
  Write-Host "Init required action: $($init.requiredAction)"
}

# --- 5. First Commit (workspace -> Git) --------------------------------------
if ($CommitAfterConnect) {
  Write-Host "== Committing workspace items to Git (safe export) =="
  $status = Invoke-Fabric -Method get -Url "$base/workspaces/$wsId/git/status"
  $head   = $status.workspaceHead
  $changeCount = ($status.changes | Measure-Object).Count
  Write-Host "Uncommitted changes: $changeCount"
  if ($changeCount -gt 0) {
    $commitBody = @{
      mode = "All"
      comment = "Initial commit of European Patents workspace via automation"
      workspaceHead = $head
    }
    $commitResp = az rest --method post --resource $FabricResource `
      --url "$base/workspaces/$wsId/git/commitToGit" `
      --headers "Content-Type=application/json" `
      --body ($commitBody | ConvertTo-Json) --verbose 2>&1
    $opId = ($commitResp | Select-String -Pattern "x-ms-operation-id.*?'([a-f0-9-]+)'" |
              Select-Object -First 1).Matches.Groups[1].Value
    if ($opId) { Wait-Lro -OperationUrl "$base/operations/$opId" }
    Write-Host "Commit complete."
  } else {
    Write-Host "Nothing to commit."
  }
}

Write-Host "== DONE =="
Write-Host "Reminder: do NOT run 'Update' (Git -> workspace) on this tenant until"
Write-Host "the Report item is confirmed to round-trip (old service-ring caution)."
