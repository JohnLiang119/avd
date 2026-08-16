## Context

See proposal.md - Why.
目前的按鈕群組位於 `<div class="queue-header">` 內，區分為左右兩個 flex container，在手機上容易擠壓。

## Goals / Non-Goals

**Goals:**
- 將頂部控制列改為雙排設計 (Double Toolbar)。
- 合併「展開」與「收合」按鈕為單一狀態切換按鈕。
- 為常用的功能（頻道追蹤、快傳、音訊切換）加上文字標籤。

**Non-Goals:**
- 不改變任何底層狀態邏輯或功能運作方式。

## Decisions

- **DOM 結構調整**:
  - 原本的 `.queue-header` (flex, space-between) 將只保留系統級別按鈕（版本號、設定、重新整理）。
  - 新增第二列專屬工具列容器（例如 `.toolbar-row`），放置控制性質按鈕（音訊模式、頻道追蹤、快傳、展開/收合、清除），並加入文字說明。
- **合併展開/收合**:
  - 利用現有的 `isAllExpanded` computed property (或自行比對目前展開狀態) 來決定按鈕圖示 (`arrow-down` / `arrow-up`)。

## Risks / Trade-offs

- **空間佔用**: 雙排會稍微佔用約 40px 的垂直高度，但可換取大幅度的操作清晰度與防誤觸性。
