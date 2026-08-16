## Why

目前使用者在主畫面輸入 YouTube 頻道網址進行單次下載時，並不會與「頻道自動追蹤」功能連動。若能在此時主動偵測並詢問是否將該頻道加入追蹤清單，將能大幅提升自動追蹤功能的能見度與使用便利性，讓「手動下載」與「自動追蹤」兩個流程無縫結合。

## What Changes

- 在 `App.vue` 中修改 `addTask` 的流程。
- 當使用者輸入的網址被判定為頻道（Channel 或 Handle）時，檢查該頻道是否已存在於 `monitoredChannels` (自動追蹤清單) 內。
- 若頻道尚未在追蹤清單內，跳出確認對話框 (Dialog)，詢問使用者：「是否將此頻道加入自動追蹤清單？」。
- 使用者若選擇「加入並下載」，則將該頻道寫入 localStorage，隨後繼續原本的下載流程。
- 使用者若選擇「僅下載」，則跳過加入追蹤，直接進入下載流程。

## Capabilities

### New Capabilities
<!-- Capabilities being introduced. Use kebab-case for path segments you introduce
     (e.g., user-auth or identity/user-auth) that follow the project's existing
     spec organization. Each creates specs/<capability-path>/spec.md. -->

### Modified Capabilities
<!-- Existing capabilities whose REQUIREMENTS are changing (not just implementation).
     Only list here if spec-level behavior changes. Each needs a delta spec file.
     Use the exact existing path under openspec/specs/. Leave empty if no requirement
     changes. A change with no capabilities at all (pure refactor, tooling, docs)
     must set `skip_specs: true` in its .openspec.yaml - openspec validate rejects
     a zero-delta change without that marker. Do not invent a requirement just to
     satisfy validation. -->
- `channel-auto-monitor`: 新增在主動輸入頻道網址時，提示加入追蹤清單的需求。

## Impact

- 影響範圍主要在前端 UI (`App.vue` 的 `addTask` 與相關 Dialog 處理邏輯)。
- 不會影響後端或 CLI 下載核心機制。
- 需確保加入清單時不會中斷或重複觸發下載任務。
