# Refine Channel Add Prompt

## Overview
Currently, when a user inputs a channel URL in the main download bar, the system asks if they want to add it to the tracked list. Regardless of their answer (or if it's already tracked), it forces a full scan of the channel's historical videos by running `parsePlaylist`. This scan is often very slow and unnecessary if the user just wants to monitor the channel for future videos.

This change refines the flow into two distinct steps:
1. **Tracking Prompt**: If the channel is not yet monitored, prompt the user to add it to the tracking list.
2. **Scan Prompt**: Regardless of tracking status, ask the user if they want to scan the channel's historical videos.
   - If "Yes", proceed with `parsePlaylist` and show the video selection modal.
   - If "No" (or Cancel), stop immediately.

## Goals
- Prevent users from being forced to wait for a slow playlist scan when they only want to track a channel for new videos.
- Improve user experience by clearly separating "Tracking" from "Scanning History".
- Support both new channels (two prompts) and already tracked channels (one prompt).

## Non-Goals
- Modifying the existing background scheduled tracking logic.
- Changing the behavior of the "Add Channel" button inside the Channel Management Modal.

## Context
This change affects `addTask` in `src/App.vue`. The logic handling `isStrictChannelUrl` needs to be updated.
