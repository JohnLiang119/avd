# OpenSpec 流程規範 (AI Coding Guidelines)

## 核心規則
1. 嚴格遵守此專案的開發流程與 OpenSpec 規範。
2. 所有任務必須先在 proposal.md 進行提案與詳細計畫，禁止產生 implementation_plan.md。
3. 開始執行任務時，需拆解步驟並記錄到 tasks.md。
4. 任務狀態需隨時同步至 tasks.md（完成時務必標記為 [x]）。
5. 語言請全面使用繁體中文。
6. 檔案編碼規範（BOM 並非一律加上，加錯會造成實際故障）：
   - `.ps1`、`.bat`、`.cs`、一般 `.md` 文件：UTF-8 **with** BOM。
   - JSON（`package.json`、`package-lock.json`、`tsconfig*.json` 等）：UTF-8 **無** BOM
     —— BOM 會使 JSON 解析器失敗，Vite 的 JSON loader 會直接中斷建置。
   - `.ts`、`.vue`：UTF-8 **無** BOM，與專案既有原始碼一致（含 `vite.config.ts`）。
   - `.java`：UTF-8 **無** BOM —— javac 不接受 BOM，會直接報
     `illegal character: '﻿'` 與 `class, interface, enum, or record expected`
     而中斷 `compileDebugJavaWithJavac`。以腳本改寫 Java 檔時務必用 `utf-8` 而非 `utf-8-sig`。
   - OpenSpec 的 delta 規格檔（`openspec/changes/*/specs/**/spec.md`）：UTF-8 **無** BOM
     —— BOM 會使 archive 讀不到第一行的 `## Purpose`，靜默在新主規格留下 TBD 佔位符。
   - git commit 訊息檔：UTF-8 **無** BOM —— 否則 BOM 會混進 commit 標題。