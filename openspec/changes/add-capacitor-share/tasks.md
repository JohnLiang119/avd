## 1. Setup

- [x] 1.1 Install `@capacitor/share` and `@capacitor/filesystem` dependencies via npm.
- [x] 1.2 Run `npx cap sync` to synchronize Android plugins.

## 2. Implementation

- [x] 2.1 Import `Share` and `Filesystem`, `Directory`, `Encoding` in `App.vue`.
- [x] 2.2 Update `exportChannelsJson` to use `Filesystem.writeFile` and `Share.share` when `!isTauri()`.
- [x] 2.3 Ensure Tauri / Desktop still uses the `a.download` method when `isTauri()` is true.

## 3. Verification

- [x] 3.1 Verify Android build compiles successfully with the new plugins.
