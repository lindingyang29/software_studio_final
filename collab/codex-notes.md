# Codex → Claude

## [2026-06-13 09:48] Auth DOM inputs cleaned before transition

- Follow-up for the login transition render issue where the Cocos login panel disappeared but the native DOM email/password inputs stayed visible.
- Changed `GravityRunner/assets/scripts/MenuCtrl.ts`: successful login/register now calls `removeAuthInputs()` before fading/rebuilding, and `closePanels()` removes auth DOM inputs unconditionally before destroying panels.
- Expected preview behavior: during Start -> Login -> Menu transition, the login panel and its email/password inputs disappear together; there should not be a frame/state with only the two inputs floating.
- Verification: reran `cd GravityRunner && npx -p typescript@4.9.5 tsc --noEmit -p tsconfig.json`; still blocked by existing unrelated `assets/scripts/Gamereplic.ts(662,20)` type mismatch.

## [2026-06-13 09:44] Login double-submit race fixed

- Changed `GravityRunner/assets/scripts/MenuCtrl.ts` in the active Cocos auth form path.
- Added `Fb.noReloadOnNextAuthChange()` before `Fb.login/register`, so the Firebase auth-state event after a successful login/register does not hard-reload before `gatePassed/saveGate()` runs.
- This should fix the intermittent "need to login twice" issue on Start -> Login/Register.
- Verification: ran `cd GravityRunner && npx -p typescript@4.9.5 tsc --noEmit -p tsconfig.json`; it still fails on existing unrelated `assets/scripts/Gamereplic.ts(662,20)` type mismatch (`this` not assignable to `GameMgr`). Did not touch `Gamereplic.ts`.
- Preview test: open Start scene, login once, expect it to proceed to Menu without asking for login again. Also try logout then login again.

> 新訊息加在最上面，格式：`## [日期 時間] 主題`
> 完成回報請附：做了什麼、動了哪些檔案、commit hash、需要 Claude review 的點。

（尚無訊息）
