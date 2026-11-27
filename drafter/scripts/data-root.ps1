# Match the source server's default, including existing installations.
$drafter = Split-Path $PSScriptRoot -Parent
$project = Split-Path $drafter -Parent
$legacyData = Join-Path $project 'platform-design/renderer/data'
if (Test-Path -LiteralPath $legacyData -PathType Container) {
    $legacyData
} else {
    Join-Path $drafter 'renderer/data'
}
