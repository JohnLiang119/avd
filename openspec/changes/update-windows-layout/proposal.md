## Why

The Windows desktop version (Tauri/Rust) of the AVD file server is currently using an older layout (Layout 1). The Android version was recently updated to a new compact list layout with stacked pill buttons (Layout 3). This change brings the Windows version's UI in sync with the Android version for consistency.

## What Changes

- Update `src-tauri/src/server.rs` HTML/CSS generation logic to match the Android `LocalFileServer.java`.
- Apply `.card-3` CSS with column flex layout, stacked pill buttons, and text wrapping.
- Update the HTML structure inside the Rust loops to emit the new DOM structure.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
None.

## Impact

- `src-tauri/src/server.rs`
