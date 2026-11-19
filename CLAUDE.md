# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Proxy Farm là một ứng dụng desktop Electron biến một subscription VPN thành nhiều cổng SOCKS5/HTTP cục bộ. Mỗi cổng chạy một process `sing-box` 1.14.2 không sửa đổi ở userspace, mỗi cổng gắn với một server VPN → một exit IP ổn định.

Tất cả mã nguồn nằm trong `app/`. Thư mục gốc còn chứa docs, `manager/`, `node/`, `site/`, `tools/` là tài liệu/di sản — không phải code đang chạy của phiên bản hiện tại (v1 Docker đã archive ở tag `v1-docker`).

## Commands (chạy trong `app/`)

```bash
pnpm install
pnpm start                 # tải sing-box (pinned sha256) rồi chạy app dev
pnpm dev                   # chạy app, bỏ qua bước tải sing-box
pnpm test                  # unit tests (vitest), hermetic — không network, không VPN thật
pnpm test -- <pattern>     # chạy một test file/pattern
pnpm exec tsc --noEmit     # type check
pnpm package               # package app (không build installer)
pnpm make                  # build installer cho platform hiện tại
pnpm test:e2e              # Playwright e2e với WireGuard peer cục bộ (cần pnpm package trước)
```

Yêu cầu: Node.js 22 (≥ 22.22.2) hoặc 24 (≥ 24.15.0), pnpm.

Dùng `PROXYFARM_USER_DATA_DIR=<path>` để chạy với data folder tạm.

Script `app/scripts/prebuild-singbox.mjs` tự chạy trước `start`/`package`/`make`, tải sing-box 1.14.2 và verify sha256 từ `app/scripts/singbox.pins.json`.

## Architecture

Electron app, giao tiếp UI ↔ main process **chỉ qua IPC** (không remote module, không node integration trong renderer). Layout:

```
app/src/
  main/
    providers/   mỗi provider một folder: hma, zoogvpn, surfshark, nordvpn, expressvpn, file
    controller/  port manager, Change IP, auto-rotate, server health, settings
    engine/      render sing-box config + invariants, supervisor, log ring, pid registry
    health/      /delay probe, exit-IP probe, back-off, port state machine
    accounts/    multi-account pools, refusal memory
    store/       state.json store + safeStorage secret store (OS keychain)
    bootstrap/   wiring: IPC facade, auto-updater, HMA local credentials, tray, speed test
    ipc/         IPC handlers
    power/       keep-awake, sleep/wake
    webhook/     optional rotate webhook
  preload/       contextBridge API phơi ra cho renderer
  renderer/      React 19 UI; i18n/en.json + i18n/vi.json chứa MỌI string UI
  shared/        contracts.ts: types dùng chung cho main/preload/renderer
```

Flow một cổng:
1. Provider `targets(account)` trả về location + pool server.
2. Controller chọn server, provider `bind(target, serverIp, account, secret)` trả endpoint sing-box (`wireguard` hoặc `openvpn-client`) — **hàm pure**.
3. Engine render config sing-box, pass qua **stdin** của tiến trình sing-box (không ghi disk).
4. Engine giữ các invariants (xem `engine/invariants.ts`) và PID registry. Supervisor giám sát process.
5. Health: `/delay` probe mỗi 30s + exit-IP/country check sau mỗi start/Change IP/test. Thất bại → back-off 30s → 30 phút.
6. DNS trong port chạy DoH tới `1.1.1.1` qua tunnel. Nếu tunnel chết, proxy fail — không fallback về mạng thật.

State lưu ở `state.json`; secrets (license, password, WG private key) được mã hoá bằng `safeStorage` của Electron (OS key store).

Server discovery (`pnpm scan:zoog-servers`, `pnpm e2e:hma`) là **maintainer-only**, không chạy ở máy user.

## Provider interface

Thêm provider mới:

1. Thêm id vào `ProviderId` trong `app/src/shared/contracts.ts`.
2. Tạo `app/src/main/providers/<id>/index.ts` implement `Provider`:
   - `check(input)` — validate & normalise input, **không network**, trả secret để lưu + metadata hiển thị.
   - `targets(account)` — danh sách location + pool server của account.
   - `bind(target, serverIp, account, secret)` — trả endpoint sing-box cho một server (pure).
3. Đăng ký ở `app/src/main/providers/index.ts`.
4. Thêm onboarding card + form (`OnboardingCards.tsx`, `Onboarding.tsx`), display name (`ui/providerName.ts`), strings vào **cả** `en.json` và `vi.json` (có unit test check parity).
5. Nếu cần URL hướng dẫn: thêm vào `PROVIDER_LINKS` ở `app/src/shared/links.ts` — chỉ URL trong list mới được phép mở trình duyệt.
6. Thêm unit test với fixture ghi sẵn. Output phải pass invariants ở `engine/invariants.ts`.
7. Nếu có network endpoint mới: cập nhật `PRIVACY.md`.

Tham khảo: `providers/zoogvpn` (OpenVPN user/pass), `providers/expressvpn` (OpenVPN + shared cert, bundled list, DNS pools), `providers/surfshark` (WireGuard, public server API).

## Non-negotiable rules

- **Unit tests phải hermetic**: không chạm network, không server VPN thật. Inject network qua interface (xem `PoolNet` ở `providers/surfshark/pool.ts`, hoặc probe functions ở `controller/engine-adapter.ts`) và dùng fixtures.
- **Không hammer provider server**. Không retry loop chặt, không mass parallel connect, không re-login liên tục. Back-off và start queue tồn tại vì lý do này — đừng bypass. Một account Surfshark đã bị suspend ngày 2026-10-08 vì mass failed WireGuard handshake.
- **Mỗi string UI mới phải có ở cả `en.json` và `vi.json`** — có unit test kiểm tra key parity.
- **Không commit secret**: license key, password, config `.ovpn`/`.conf`, `.env`, IP cá nhân, log có credential.
- Giữ `bind()` pure; mọi side-effect (network, disk) ở lớp controller/engine/health.

## Commit style

- Subject imperative, ≤72 ký tự, không dấu chấm cuối. Prefix area optional: `controller: …`, `surfshark: …`, `i18n: …`.
- Body giải thích **why**, không nhắc lại diff.
- Một thay đổi logic / commit.

PR checklist: `pnpm test` pass, `pnpm exec tsc --noEmit` pass, test cho hành vi mới, i18n parity, không secret, network mới ghi vào `PRIVACY.md`, UI đổi thì kèm screenshot.

## Design doc

`docs/superpowers/specs/2026-10-07-desktop-app-design.md` — giải thích lý do thiết kế engine, health check và server pool.
