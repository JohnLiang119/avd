## Purpose

Introduces a robust filtering mechanism to the background auto-check system to discard live streams without impacting the initial channel scanning speed.

## ADDED Requirements

### Requirement: Exclude Live Streams from Queue
The system MUST perform a secondary validation on newly discovered videos from the RSS feed. If the video is currently broadcasting live or is scheduled as an upcoming premiere, the system MUST NOT add it to the download queue.

#### Scenario: Active live stream discovered
- **WHEN** the RSS check detects a new video URL that is an active live stream
- **THEN** the system verifies its status and silently ignores the video, leaving the download queue unaffected.

#### Scenario: Normal pre-recorded video discovered
- **WHEN** the RSS check detects a normal video or a completed past live stream (VOD)
- **THEN** the system verifies its status and successfully adds the video to the download queue for processing.
