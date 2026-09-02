## 1. Implement Verification Helper

- [x] 1.1 In `DownloadService.ts`, add a `checkVideoLiveStatus(url: string)` method that uses `yt-dlp --print "live_status" <url>`.
- [x] 1.2 Return a boolean indicating if it's an active or upcoming live stream (`true` if `is_live` or `is_upcoming`, else `false`).

## 2. Integrate with Auto-Check

- [x] 2.1 In `App.vue` (`checkAllMonitoredChannels`), locate the block where `newVideos` are mapped into `DownloadTask` objects.
- [x] 2.2 Add an asynchronous check `await DownloadService.checkVideoLiveStatus(vid.url)` before creating the task.
- [x] 2.3 Skip adding the video to the queue if the live status check returns `true`.
