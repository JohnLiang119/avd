# capacitor-share-export Specification

## Purpose
Provides a native file sharing mechanism for Android, ensuring backup exports bypass WebView restrictions and can be saved to the device or cloud storage.
## Requirements
### Requirement: Android Native Share Export
The system SHALL use the Capacitor Share plugin to handle local backup exports when running in an Android (Capacitor) environment.

#### Scenario: User exports backup on Android
- **WHEN** user clicks "匯出本地備份" on an Android device
- **THEN** system writes the backup JSON to a temporary file and opens the native Android Share dialog for the user to choose the destination.

