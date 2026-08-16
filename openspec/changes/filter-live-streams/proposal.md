## Why

Our background channel auto-check feature relies on YouTube's RSS feeds because they are extremely fast to fetch (under 1 second). However, RSS feeds lack metadata to indicate if a video is a live stream or an upcoming premiere. Consequently, the system blindly adds live streams to the download queue, which later fail or stall because they cannot be downloaded normally. 

We need a way to filter out live streams during the auto-check process without slowing down the initial discovery scan.

## What Changes

- Add a "two-stage filtering" mechanism in `checkAllMonitoredChannels`.
- Stage 1: Fast RSS check to detect new videos (existing behavior).
- Stage 2: When new videos are found, verify their status using `yt-dlp --print "live_status" <url>`.
- Skip adding the video to the queue if `yt-dlp` reports `is_live` or `is_upcoming`.

## Capabilities

### New Capabilities
- `auto-check-filtering`: The background auto-check system now selectively ignores videos based on their live status.

### Modified Capabilities

## Impact

- **`App.vue` (`checkAllMonitoredChannels`)**: Will introduce a secondary `yt-dlp` verification step only when new videos are discovered via RSS.
- **Performance**: Channel check speed remains fast for the vast majority of cases (when no new videos exist). It will incur a ~3 second penalty only when a new video is actually published.
- **Download Queue**: Will no longer be cluttered with undownloadable active live streams.
