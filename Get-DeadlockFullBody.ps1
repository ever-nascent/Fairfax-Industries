# Get-DeadlockFullBody.ps1
# Downloads each hero's full-body render (deadlock.wiki "File:<Hero> Render.png") at original size.
# Same hero list as setup.py HEROES. File names match the portraits (mo_krill.png, the_doorman.png).

$ErrorActionPreference = 'Stop'
$WikiApi = 'https://deadlock.wiki/api.php'
$OutDir  = 'D:\Projects\Discord Bots\Fairfax Industries\assets\heroes\full body'
$Heroes  = @(
    'Abrams', 'Apollo', 'Bebop', 'Billy', 'Calico', 'Celeste', 'The Doorman', 'Drifter',
    'Dynamo', 'Graves', 'Grey Talon', 'Haze', 'Holliday', 'Infernus', 'Ivy', 'Kelvin',
    'Lady Geist', 'Lash', 'McGinnis', 'Mina', 'Mirage', 'Mo & Krill', 'Paige', 'Paradox',
    'Pocket', 'Rem', 'Seven', 'Shiv', 'Silver', 'Sinclair', 'Venator', 'Victor',
    'Vindicta', 'Viscous', 'Vyper', 'Warden', 'Wraith', 'Yamato'
)
$UA = 'Mozilla/5.0 (fairfax-setup)'

# One API call for all 38 file URLs (the wiki allows 50 titles per query).
# Titles use spaces, not underscores: the wiki answers with that spelling, so the lookups below match.
$titles = ($Heroes | ForEach-Object { "File:$_ Render.png" }) -join '|'
$query  = "$WikiApi`?action=query&prop=imageinfo&iiprop=url&format=json&titles=$([uri]::EscapeDataString($titles))"
$result = Invoke-RestMethod -Uri $query -UserAgent $UA

$urls = @{}
foreach ($p in $result.query.pages.PSObject.Properties.Value) {
    if ($p.imageinfo) { $urls[$p.title] = $p.imageinfo[0].url }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$ok = 0
$failed = @()

foreach ($hero in $Heroes) {
    $url = $urls["File:$hero Render.png"]
    if (-not $url) { $failed += "$hero (no 'File:$hero Render.png' on the wiki)"; continue }
    $slug = (($hero -replace '[^A-Za-z0-9]+', '_').Trim('_')).ToLower()
    try {
        Invoke-WebRequest -Uri $url -OutFile (Join-Path $OutDir "$slug.png") -UserAgent $UA -UseBasicParsing
        $ok++
    } catch {
        $failed += "$($hero): $($_.Exception.Message)"
    }
}

Write-Host "`n===== Summary ====="
Write-Host "Downloaded: $ok / $($Heroes.Count)"
Write-Host "Failed:     $($failed.Count)"
$failed | ForEach-Object { Write-Host "  - $_" }
