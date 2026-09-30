# Get-DeadlockPortraits.ps1
# Downloads Deadlock hero card (tall portrait) images from the community Deadlock API.
#
# Checkpoint 1:  .\Get-DeadlockPortraits.ps1 -Inspect   (prints fields only, downloads nothing)
# Checkpoint 2:  .\Get-DeadlockPortraits.ps1            (downloads + prints a verification summary)

param([switch]$Inspect)

$ErrorActionPreference = 'Stop'
$Endpoint = 'https://api.deadlock-api.com/v1/assets/heroes?language=english'
$OutDir   = 'D:\Projects\Discord Bots\Fairfax Industries\assets\heroes\potraits'

Write-Host "Fetching: $Endpoint"
# No @() here: in Windows PowerShell 5.1 it wraps the whole JSON array as a single item
$heroes = Invoke-RestMethod -Uri $Endpoint
Write-Host "Heroes returned by API: $($heroes.Count)"

# ---------- Checkpoint 1: inspect fields ----------
if ($Inspect) {
    $first = $heroes[0]
    Write-Host "`nTop-level fields on '$($first.name)':"
    Write-Host ("  " + ($first.PSObject.Properties.Name -join ', '))
    Write-Host "`nImage fields on '$($first.name)':"
    $first.images.PSObject.Properties | ForEach-Object { Write-Host "  $($_.Name) = $($_.Value)" }
    return
}

# ---------- Pick the hero card image field ----------
$cardKeys = @($heroes[0].images.PSObject.Properties.Name | Where-Object { $_ -like '*hero_card*' })
if ($cardKeys.Count -eq 0) {
    throw "No image field containing 'hero_card' was found. Run with -Inspect and share the image field names."
}
$key = $cardKeys | Where-Object { $_ -notlike '*webp*' } | Select-Object -First 1
if (-not $key) { $key = $cardKeys[0] }
Write-Host "Using image field: $key"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$ok = 0
$skipped = @()
$failed  = @()

foreach ($h in $heroes) {
    # Skip heroes the API marks as not selectable, only if that field exists
    if ($h.PSObject.Properties.Name -contains 'player_selectable' -and -not $h.player_selectable) {
        $skipped += "$($h.name) (not player_selectable)"; continue
    }
    $url = $h.images.$key
    if (-not $url) { $skipped += "$($h.name) (no $key image)"; continue }

    $ext = [IO.Path]::GetExtension(([uri]$url).AbsolutePath)
    if (-not $ext) { $ext = '.png' }
    $slug = (($h.name -replace '[^A-Za-z0-9]+', '_').Trim('_')).ToLower()
    $dest = Join-Path $OutDir "$slug$ext"

    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        $ok++
    } catch {
        $failed += "$($h.name): $($_.Exception.Message)"
    }
}

# ---------- Checkpoint 2: verification summary ----------
Write-Host "`n===== Summary ====="
Write-Host "Downloaded: $ok"
Write-Host "Skipped:    $($skipped.Count)"
$skipped | ForEach-Object { Write-Host "  - $_" }
Write-Host "Failed:     $($failed.Count)"
$failed  | ForEach-Object { Write-Host "  - $_" }

Write-Host "`nFiles in $OutDir :"
Get-ChildItem $OutDir -File | Sort-Object Name |
    Format-Table Name, @{ Name = 'KB'; Expression = { [math]::Round($_.Length / 1KB, 1) } } -AutoSize
