## REMOVED Requirements

### Requirement: yt-dlp RSS 備援擷取

**Reason**: 該能力的存在前提是「官方 RSS 不穩時，yt-dlp 能提供品質足夠的備援」。2026-09-10 實測證明此前提不成立，三項缺陷各自都足以否決它：

- **標題為自動翻譯的英文**。`--flat-playlist` 對 `vf2Df3qFG9A` 回傳 `Kombucha Quality Matters! Watch...`，真實標題為「康普茶品質優劣原來差這麼多！抽好禮看特輯~專訪發酵專家...」。頻道關鍵字篩選比對的正是標題，走此通道時使用者設定的中文關鍵字一個都不會命中 —— 功能靜默失效且無從察覺。
- **含會員限定影片**。`S4VRYfcLrLk` 出現於清單中，實際查詢回 `Join this channel to get access to members-only content`，建立任務後下載必然失敗。
- **排序非最新優先**。`--playlist-end 12` 取回的最新一筆實為 09-08 的舊片。此能力唯一的職責就是「RSS 失效時仍能取得新片」，而它連此事都做不到。

另有既知限制：`--flat-playlist` 不提供精確發布時間，時間錨點無從安全推進。

**Migration**: 頻道影片擷取改由 `youtube-data-api-channel` 單一負責。使用者需於設定中填入自備的 YouTube Data API 金鑰；未設定時頻道追蹤停止並明確告知，不再有替代來源。yt-dlp 於本專案的其他用途（影片下載、頻道網址解析）不受影響。
