# Design

## Architecture Changes
No architectural changes are required. This is a targeted UI flow modification in the frontend Vue component `App.vue`.

## Implementation Strategy

### App.vue - `addTask` function modification
We will update the `isStrictChannelUrl` conditional block in `addTask`.

1. **Check if channel is already monitored:**
   Store this in a variable `isMonitored`.
   ```typescript
   const isMonitored = monitoredChannels.value.some(c => c.channelId === channelInfo.channelId);
   ```

2. **First Prompt (Add to tracking):**
   Only show this if `!isMonitored`.
   Change the buttons to "加入追蹤" (Confirm) and "不加入" (Cancel).
   If confirmed, push the new channel to `monitoredChannels.value`.
   If cancelled, swallow the exception (do nothing, just continue).

3. **Second Prompt (Scan history):**
   Show this unconditionally for all strict channel URLs (whether they were already tracked, or just added, or rejected).
   ```typescript
   try {
     await showConfirmDialog({
       title: '掃描歷史明細',
       message: `是否要掃描「${channelInfo.title || urlToAdd}」的歷史影片明細？\n\n(若頻道影片較多，可能需要較長時間)`,
       confirmButtonText: '掃描並選擇下載',
       cancelButtonText: '略過',
       confirmButtonColor: '#1989fa'
     });
   } catch {
     // User chose "略過" (Cancel)
     return; // IMPORTANT: abort addTask here to prevent parsing playlist
   }
   ```
   If confirmed, the code simply falls through to the existing `isPlaylistUrl` block where it performs the actual scanning.

### Error Handling
If `DownloadService.resolveYouTubeChannel` fails, we should gracefully close the toast and log the error, then we can `return` early because if we can't resolve the channel, we shouldn't attempt to parse it as a playlist either, or we let it fall through but since `resolveYouTubeChannel` failed, it's safer to just return. Actually, in the current implementation, it catches the error and continues. We can maintain that behavior, but if it fails, it will just fall through to the playlist check.

## Testing Strategy
- Add a new channel URL. Expect two prompts. Choose "Yes" then "No". Verify it's added but no playlist modal appears.
- Add an already tracked channel URL. Expect one prompt. Choose "Yes", verify the playlist modal appears after scanning.
