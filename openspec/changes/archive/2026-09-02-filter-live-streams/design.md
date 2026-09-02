## Context

Our auto-check background job fetches YouTube RSS feeds to quickly discover new videos without incurring heavy processing overhead. See `proposal.md` for the motivation. 

Because RSS does not indicate live stream status, we need to add a supplementary check to discard live streams.

## Goals / Non-Goals

**Goals:**
- Identify and discard active live streams (`is_live`) and scheduled premieres (`is_upcoming`) when a new video is discovered.
- Keep the baseline performance of the channel check loop identical to current behavior (when no new videos are found).

**Non-Goals:**
- Do not migrate the entire RSS checking mechanism to `yt-dlp`. 

## Decisions

### 1. Two-Stage Validation Approach
**Decision**: Retain the fast RSS fetch, but add a `yt-dlp --print "live_status"` step specifically for any newly discovered video URLs *before* they are queued.
**Rationale**: `yt-dlp` takes 3~5 seconds to fetch info. Performing this check unconditionally on every channel fetch would destroy the performance of the background job. By only triggering it when `newVideos.length > 0`, we only pay the performance cost when it's absolutely necessary.
**Alternatives Considered**: 
- *Fetch full channel playlists with yt-dlp*: Rejected due to severe performance degradation.

### 2. Execution Layer
**Decision**: Implement the `yt-dlp` check as a helper function in `DownloadService.ts` (`checkVideoLiveStatus(url: string)`), which will be awaited in the loop inside `App.vue` (`checkAllMonitoredChannels`).
**Rationale**: `DownloadService` already encapsulates all interactions with the `yt-dlp` sidecar binary, maintaining clean separation of concerns.

## Risks / Trade-offs

- **[Risk]** `yt-dlp` might fail or hang when querying the `live_status`.
  - **Mitigation**: The execution should be wrapped in a `try-catch` block with a timeout. If it fails, we can optionally choose to default to adding it to the queue (to avoid missing a video) or skipping it. We will default to adding it if the check fails.
