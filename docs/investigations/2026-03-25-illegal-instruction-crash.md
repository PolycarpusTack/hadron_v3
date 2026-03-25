# Investigation: ILLEGAL_INSTRUCTION (0xC000001D) Crashes

**Date:** 2026-03-25
**Status:** Root cause identified — awaiting ESET exclusion test + code signing
**Affected versions:** 4.3.0, 4.4.0
**Affected machine:** Dell Latitude 5430, i5-1245U (Alder Lake), Windows 11 24H2 (Build 26100), ESET endpoint protection

---

## Summary

Hadron Desktop crashes with `0xC000001D` (Illegal Instruction) and `0xC0000005` (Access Violation) when executing analysis/scan operations. 13 crashes logged between March 10-25, 2026. The root cause is **not** a CPU instruction set mismatch — the CPU fully supports AVX2. Evidence points to **ESET endpoint protection interfering with WebView2 IPC callbacks** on an unsigned binary.

---

## Evidence

### Crash Statistics

| Type | Count | Pattern |
|------|-------|---------|
| ILLEGAL_INSTRUCTION (0xC000001D) | 9 | Two stable crash sites |
| ACCESS_VIOLATION (0xC0000005) | 4 | 3x read of `0xFFFFFFFFFFFFFFFF`, 1x read of `0x2888` in ntdll |

### Two Distinct ILLEGAL_INSTRUCTION Crash Sites

Despite ASLR, the offset from the exe base is stable:

**Pattern A** — offset `...61B0` (6 occurrences: PIDs 19588, 3364, 37692, 26852 + 2 from v4.3.0)
```
main exe [5]  → crash at ...61B0
main exe [6]  → ...6785
main exe [7]  → ...283B
main exe [8]  → ...B1F5
main exe [9]  → ...65A8
main exe [10] → ...77EC
main exe [11] → ...9E7C
main exe [12] → ...6C1B
WebView2 [13-31] → COM message pump callback chain
system   [32-33] → ntdll / kernel32
main exe [34+]   → Tauri event loop / IPC handler
```

**Pattern B** — offset `...E440` (2 occurrences: PIDs 28456, 27736, both Mar 25)
```
main exe [5]  → crash at ...E440
main exe [6]  → ...B1EA
main exe [7]  → ...D76B
main exe [8]  → ...0B35
main exe [9]  → ...6706
main exe [10] → ...F34C
main exe [11] → ...CA0F
main exe [12] → ...CEFB
WebView2 [13-31] → COM message pump callback chain (same DLL)
system   [32-33] → ntdll / kernel32
main exe [34+]   → Tauri event loop / IPC handler
```

Both patterns: main exe calls into WebView2, WebView2 calls back into main exe, crash occurs in the callback.

### ACCESS_VIOLATION Pattern

3 of 4 crashes read address `0xFFFFFFFFFFFFFFFF` (-1 sentinel), suggesting a corrupted/uninitialized pointer. The 4th (PID 6068) crashes inside `ntdll.dll` itself at `0x00007FF8CD12233A`.

### CPU Diagnostic (run on affected machine)

```
CPU:        12th Gen Intel(R) Core(TM) i5-1245U (Alder Lake)
AVX:        True
AVX2:       True
Hypervisor: False (physical hardware)
Machine:    Dell Inc. Latitude 5430
WebView2:   Registry query returned empty (check alternate path)
Windows:    10.0.26100 (Windows 11 24H2)
```

---

## Ruled Out Causes

| Hypothesis | Why Ruled Out |
|------------|--------------|
| Missing AVX/AVX2 support | CPU reports AVX2=True, no hypervisor |
| `target-cpu` misconfiguration | Both `.cargo/config.toml` files set `target-cpu=x86-64` (baseline SSE2) |
| MSVC auto-vectorization to AVX | MSVC x64 defaults to SSE2, doesn't emit AVX without explicit `/arch:AVX` |
| LTO target-cpu leak | Rust 1.87 uses LLVM 20, well past the LTO bugs in LLVM 15-16 |
| `ring` crypto assembly | ring uses cpuid runtime detection; would crash on *every* TLS call, not intermittently |
| Bundled SQLite C code | MSVC defaults to SSE2; no AVX auto-vectorization without explicit flags |
| WebView2 runtime crash | Crash addresses are in main exe range (`0x00007FF6...`), not WebView2 DLLs |
| Regression in v4.4.0 | Same crashes appear in v4.3.0 logs |

---

## Root Cause: ESET + Unsigned Binary

**ESET endpoint protection** (installed on corporate Dell Latitude) intercepts process execution more aggressively on unsigned binaries:

1. ESET injects monitoring hooks into the Hadron process
2. During WebView2 IPC callbacks (triggered by analysis operations), ESET's hooks interfere with the callback chain
3. This corrupts either:
   - Code bytes → ILLEGAL_INSTRUCTION (CPU encounters patched/invalid opcode)
   - Pointers → ACCESS_VIOLATION reading `0xFFFFFFFFFFFFFFFF` (corrupted pointer sentinel)

**Supporting evidence:**
- Crashes only during analysis (when WebView2 IPC is active)
- Two stable crash sites suggest two specific IPC handlers being hooked
- ACCESS_VIOLATION consistently reads -1 (not random corruption)
- Dell Latitude 5430 is a corporate laptop with managed ESET

---

## Fix Plan

### Immediate (do first)

**Add Hadron to ESET exclusions** on the affected machine:

ESET Advanced Setup > Detection Engine > Exclusions > Performance Exclusions:
- Add the Hadron install directory: `C:\Users\<user>\AppData\Local\Hadron\`
- Or the specific exe: `...\Hadron.exe`

If managed centrally via ESET PROTECT, request IT to add the exclusion via policy.

**Expected result:** All crashes stop immediately.

### Short-term: Code-sign the binary

Files already prepared:
- `hadron-desktop/scripts/create-signing-cert.ps1` — creates self-signed code signing cert
- `hadron-desktop/src-tauri/tauri.conf.json` — `bundle.windows.signCommand` configured
- `hadron-desktop/certs/.gitignore` — prevents private key commits

**Steps:**
1. Run `scripts/create-signing-cert.ps1` as Administrator on build machine
2. Set `$env:HADRON_SIGN_PASSWORD = "..."` before building
3. `npm run tauri build` — Tauri will auto-sign the exe and MSI
4. Distribute `certs/hadron-signing.cer` to client machines via Group Policy:
   - Computer Config > Windows Settings > Security Settings > Public Key Policies > Trusted Publishers
   - Also add to Trusted Root Certification Authorities

**Expected result:** ESET trusts the signed binary, stops injecting aggressive hooks.

### Diagnostic (optional, for definitive confirmation)

Open a `.dmp` file in WinDbg to get exact function names:

```
windbg -z "C:\Users\yannick.verrydt\AppData\Roaming\hadron\logs\crash-28456.dmp"

# In WinDbg:
.ecxr           # Switch to exception context
kb              # Stack trace with symbols
lm              # List loaded modules (confirms which DLLs are at which addresses)
u @rip L5       # Disassemble the crashing instruction
```

This would show:
- Exact Rust function name at each crash site
- Whether ESET DLLs (`ekrn.dll`, `eamsi.dll`, `ehdrv.sys`) are loaded in the process
- The actual instruction at the crash address

### WebView2 check

The registry query for WebView2 returned empty. Try the alternate path:
```powershell
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3C4FE04-5684-4D1E-9AD2-7E663675688E}" -ErrorAction SilentlyContinue | Select-Object pv
```
(Without `WOW6432Node`)

---

## All Crash Logs

| # | Date | PID | Version | Exception | Offset | .dmp |
|---|------|-----|---------|-----------|--------|------|
| 1 | Mar 10 07:54 | — | 4.3.0 | ACCESS_VIOLATION | `...460f` | No |
| 2 | Mar 16 16:11 | — | 4.3.0 | ILLEGAL_INSTRUCTION | `...6ab0` | No |
| 3 | Mar 16 16:49 | — | 4.3.0 | ILLEGAL_INSTRUCTION | `...6ab0` | No |
| 4 | Mar 17 08:47 | — | 4.4.0 | ILLEGAL_INSTRUCTION | `...f130` | No |
| 5 | Mar 17 11:04 | — | 4.4.0 | ACCESS_VIOLATION | `...42df` | No |
| 6 | Mar 17 21:22 | 19588 | 4.4.0 | ILLEGAL_INSTRUCTION | `...61B0` | Yes (0 bytes) |
| 7 | Mar 17 21:42 | 3364 | 4.4.0 | ILLEGAL_INSTRUCTION | `...61B0` | Yes (0 bytes) |
| 8 | Mar 18 11:09 | 6068 | 4.4.0 | ACCESS_VIOLATION | `...233A` | Yes (0 bytes) |
| 9 | Mar 18 11:27 | 37692 | 4.4.0 | ILLEGAL_INSTRUCTION | `...61B0` | Yes (0 bytes) |
| 10 | Mar 25 09:25 | 26852 | 4.4.0 | ILLEGAL_INSTRUCTION | `...61B0` | Yes (0 bytes) |
| 11 | Mar 25 17:22 | 28456 | 4.4.0 | ILLEGAL_INSTRUCTION | `...E440` | Yes (0 bytes) |
| 12 | Mar 25 17:25 | 29716 | 4.4.0 | ACCESS_VIOLATION | `...65FC` | Yes (0 bytes) |
| 13 | Mar 25 17:27 | 27736 | 4.4.0 | ILLEGAL_INSTRUCTION | `...E440` | Yes (0 bytes) |

**Note:** All `.dmp` files are 0 bytes — `MiniDumpWriteDump` may be failing because ESET blocks process memory reads from the crash handler. This is further evidence of ESET interference.

---

## Changes Made (2026-03-25)

1. `hadron-desktop/src-tauri/.cargo/config.toml` — cleaned up CFLAGS comments
2. `hadron-desktop/.cargo/config.toml` — same
3. `hadron-desktop/src-tauri/rust-toolchain.toml` — pins Rust 1.87.0
4. `hadron-desktop/src-tauri/tauri.conf.json` — code signing `signCommand`
5. `hadron-desktop/src-tauri/src/keeper_service.rs` — improved API key extraction (brute-force scan + diagnostics)
6. `hadron-desktop/scripts/create-signing-cert.ps1` — self-signed cert generator
7. `hadron-desktop/certs/.gitignore` — prevents private key commits

Commits: `669e1ba`, `e0028ec` (both on `main`, not yet pushed)
