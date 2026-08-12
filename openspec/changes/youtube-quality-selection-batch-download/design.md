# 技術設計與架構 (Technical Design)

## Context

參閱 [proposal.md](file:///c:/JohnLiang/..Project/avd_vue/openspec/changes/youtube-quality-selection-batch-download/proposal.md) 的背景說明。現有的 `DownloadService.ts` 已包含 `parsePlaylist` 函數與播放清單解析能力。現有 UI 需補強一個批次下載選集嚮導彈窗，讓使用者在 YouTube 連結解析後能勾選欲下載的集數/影片，並一次性批次整批加入下載佇列執行。

## Goals / Non-Goals

**Goals:**
- 提供直觀的 Modal / Dialog 對話框，展示解析出的播放清單與影片列表。
- 支援項目勾選狀態控制（全選 / 全不選 / 複選指定集數或影片）。
- 點擊「開始批次下載」後將勾選項轉為下載佇列，一次性觸發批次下載。
- 於 UI 主介面上即時展示佇列狀態、單項下載進度條與下載速度。

**Non-Goals:**
- 本階段不修改 `DownloadService.ts` 已有的播放清單解析邏輯（`parsePlaylist`）。

## Decisions

1. **元件劃分：獨立 `YouTubeBatchModal.vue` 元件**
   - **理由**：將彈窗 UI、勾選狀態（`selectedItemIds`）、全選/全不選按鈕與「開始批次下載」發射事件獨立封裝。

2. **佇列控制與狀態派發**：
   - **理由**：Modal 點擊「開始批次下載」時傳出已勾選的 `PlaylistItem[]`，主介面或 `DownloadService` 迭代將其推入下載佇列中處理。

## Risks / Trade-offs

- [Risk] 長播放清單（如數百集影片）勾選清單渲染效能 → [Mitigation] 採用滾動列表與快速「全選/全不選」控制，保持回應流暢。
