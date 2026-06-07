# Device Limit Bug — Debug Notes (2026-04-17)

## Problem
4th device keeps connecting successfully despite max_devices=3 limit.
User sees 4/3 in UI. VPN works on 4th device — it gets valid VLESS config.

## Current state (as of 15:04)

### DB: device_sessions (user tg=2029065770)
```
3 sessions (cleaned to 3 multiple times, but 4th keeps appearing):
  id=55 | Windows | hash=windows_2603201341504     | ip=213.111.139.199
  id=53 | Windows | hash=windows_2604081205607     | ip=95.25.55.174
  id=52 | Android | hash=android_17764066464421463575 | ip=95.25.55.174
```
iPhone (hash=ios_2604141213534) is the device user keeps testing as "4th".

### DB: vpn_keys
```
Shared key: id=32, hash=01040f0c-fc94-4e6d-a99e-f60233a97c41, active=true, sub_id=21
Per-device keys (leftover, should be cleaned up): ids 34-40, uri='per-device'
```

### DB: subscription
```
sub_id=21, status=active, end=2026-04-19, plan=18, max_devices=3
```

### DB: indexes on device_sessions
```
UNIQUE INDEX device_sessions_user_id_device_hash_key ON (user_id, device_hash) — EXISTS ✓
```

## Approaches tried (all failed to block 4th device)

### 1. Rank-based (ROW_NUMBER ORDER BY last_seen_at DESC)
- BUG: new device gets rank=1 (newest = best rank), so rank > 3 NEVER triggers
- Code: upsert → check rank → if rank > max → block
- Why failed: the device being checked always has rank 1

### 2. Count-before-create (check count, only create if < limit)
- Code: check if session exists → if new: count → if >= max → block, else create
- Why failed: USER REPORTS it still connected. Possible causes:
  - Deploy hadn't propagated when tested
  - 4th device hash matched existing session (UPDATE path, no limit check)

### 3. xmax=0 detect INSERT vs UPDATE
- Code: upsert RETURNING (xmax=0) → count → if isNew && total > max → delete + block
- Why failed: USER REPORTS same issue.
- Possible causes:
  - **Deploy not live yet** — Timeweb may be slow/caching
  - **4th device hash matches existing session** — would be UPDATE, skips block
  - **try/catch swallows errors** — if upsert or count query fails, falls to catch, returns valid config

## Key hypothesis for next session

**MOST LIKELY**: The 4th device the user is testing with has a device_hash that 
MATCHES one of the 3 existing sessions. When the user adds a subscription on the 
"4th device", Happ generates the same device ID as one of the existing devices.

Evidence: the sessions keep being recreated with new IDs (35→47→52, etc.) suggesting
all 4 physical devices keep refreshing and re-upserting. The ON CONFLICT triggers 
UPDATE (not INSERT), so xmax != 0 → isNewDevice=false → no limit check.

**To verify**: Add logging that shows device_hash for EVERY request to /api/sub/[token],
and check Timeweb logs. If the 4th device's hash matches an existing one, that confirms it.

**Alternative hypothesis**: Timeweb isn't deploying the new code. Test by adding a
unique header or response marker to verify which code version is actually running.

## Recommended fix approach for next session

1. **Verify deploy**: Add a version header like `X-Code-Version: 2026-04-17-v8` to 
   the sub endpoint response. Check this header from a client to confirm the latest 
   code is deployed.

2. **If deploy is working but hash collision**: The device_hash for Happ includes 
   `{deviceType}_{hiddifyDeviceId}`. If two devices have the same hiddifyDeviceId 
   (unlikely but possible with Happ bugs), they'd be treated as one device. Fix: 
   include more identifying info in hash (e.g., Happ version, or IP).

3. **If deploy is NOT working**: Check Timeweb CI/CD logs, manual redeploy, or SSH 
   to check what's running.

4. **Nuclear option**: Don't rely on subscription endpoint for enforcement. Instead,
   use per-device VPN keys properly (each device gets unique UUID, only top-N UUIDs
   synced to Xray). This was tried before but broke VPN — needs careful implementation.

## Files involved
- `app/api/sub/[token]/route.ts` — subscription endpoint (device tracking + limit)
- `app/api/users/devices/route.ts` — device list + delete API
- `app/api/xray/clients/route.ts` — Xray sync (returns active UUIDs)
- `lib/sub-token.ts` — VLESS link generation
- `db/schema.sql` — device_sessions table schema

## Git history (latest first)
```
2f1f203 fix: use xmax=0 to detect new vs existing device
c004a97 fix: always check device rank for ALL devices
9ed4d00 fix: revert happ from isSingboxClient
606e8d5 fix: simplified JSON format for device limit error
4786d24 fix: add happ to singbox detection
46aefe0 fix: check count before creating session
b330ce6 fix: rank-based device limit
c34ec7f fix: exclude per-device keys from sub endpoint
f2d9461 revert: remove per-device keys, use shared key
```
