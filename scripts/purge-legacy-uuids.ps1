# One-shot cleanup: invalidate all "ghost" UUIDs left over from the
# pre-v47 soft-kick era. Run ONCE after deploying v47.

$token = 'hVpN2026sEcReT_xR4y'
$base = 'https://hundlervpn.xyz/api/xray/pool'

Write-Host "=== Pool stats BEFORE ==="
Invoke-RestMethod -Method GET -Uri "$base`?token=$token" | ConvertTo-Json -Depth 5

Write-Host "`n=== Running purge-free ==="
Invoke-RestMethod -Method POST -Uri "$base`?token=$token&action=purge-free" | ConvertTo-Json -Depth 5

Write-Host "`n=== Pool stats AFTER ==="
Invoke-RestMethod -Method GET -Uri "$base`?token=$token" | ConvertTo-Json -Depth 5
