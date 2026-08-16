## 1. Top Bar Reorganization

- [x] 1.1 In `App.vue`, locate `<div class="queue-header">` and remove the left-side icons (server, mp3 mode, channel tracking) from it.
- [x] 1.2 In `App.vue`, remove the right-side `expandAll` and `collapseAll` buttons.
- [x] 1.3 In `App.vue`, remove the right-side `delete-o` (clear completed) button from `.queue-header`.
- [x] 1.4 Keep only the `v{{ version }}`, refresh (`replay`), and settings (`setting-o`) buttons in the `.queue-header`.

## 2. Implement Control Toolbar

- [x] 2.1 Below `.queue-header`, create a new `<div>` (e.g., `<div class="toolbar-row" style="display: flex; gap: 8px; overflow-x: auto; padding: 0 5px 10px; margin-bottom: 5px; border-bottom: 1px solid #eee;">`) to serve as the second row toolbar.
- [x] 2.2 Add the MP3 Mode toggle button into the new toolbar with the text label "音訊".
- [x] 2.3 Add the Channel Tracking toggle button into the new toolbar with the text label "頻道".
- [x] 2.4 Add the Local Server toggle button into the new toolbar with the text label "快傳".
- [x] 2.5 Add a single combined Expand/Collapse toggle button into the new toolbar with the text label "展開" or "收合" (based on current state), executing `expandAll` or `collapseAll` appropriately.
- [x] 2.6 Add the Clear Completed (`delete-o`) button into the new toolbar with the text label "清除".

## 3. Style Polish

- [x] 3.1 Review button margins and paddings in the new `.toolbar-row` to ensure they fit well horizontally without wrapping awkwardly.
- [x] 3.2 Ensure the new layout does not break the view in `isTvMode` (some buttons are conditionally hidden in TV mode).
