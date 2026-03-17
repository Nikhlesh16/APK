# FocusModeBlocker: Local Digital Behavior Automation (React Native + Android)

This app is a local-only Android automation system that enforces behavior rules on top of phone usage.
No backend or cloud service is required.

## Platform and Runtime

- React Native UI + TypeScript
- Android native modules/services in Kotlin
- Android 10+
- Local storage only
- Background monitoring via foreground service

## Core Capabilities

1. Device inactivity detection
2. App usage monitoring with limits
3. Rule-based automation and app restriction

## Supported Rule Types

- `continuous_usage_rule`
	- Example: block YouTube after daily usage threshold
- `inactivity_rule`
	- Example: if device unused for 7 hours, trigger periodic vibration/notification
- `app_dependency_rule`
	- Example: while in VS Code flow, switching to Instagram/YouTube is blocked
- `unlock_choice_rule`
	- Session mode where user chooses one app after unlock

## Actions

- `block_app`
- `restrict_switching`
- `vibrate`
- `show_notification`

## Android APIs Used

- `UsageStatsManager`
- `AccessibilityService`
- `Foreground Service`
- `Alarm/Vibration/Notification scheduling behavior via monitor loop`

## Local Database Schema (SQLite)

Native SQLite is implemented in `AutomationDatabaseHelper.kt`.

### Rules

- `id`
- `rule_type`
- `target_app`
- `trigger_app`
- `threshold_minutes`
- `interval_minutes`
- `restricted_apps`
- `action`
- `enabled`
- `start_time`
- `end_time`
- `days_json`
- `daily_limit_minutes`
- `alert_type`

### UsageEvents

- `id`
- `package_name`
- `start_time`
- `end_time`
- `duration`

### DeviceState

- `last_unlock_time`
- `screen_state`

## Monitoring Loop

`ForegroundMonitorService` runs every few seconds and:

1. Detects current foreground app
2. Logs usage session transitions to SQLite
3. Evaluates all enabled rules in `RuleEvaluator`
4. Enforces restrictions via `BlockingActivity`
5. Triggers inactivity alerts at configured intervals

## Project Structure

```text
src/
	components/
	database/
	rules/
	screens/
	services/
	types/
android/app/src/main/java/com/focusmodeblocker/
	AutomationDatabaseHelper.kt
	FocusModeModule.kt
	ForegroundMonitorService.kt
	RuleEvaluator.kt
	FocusAccessibilityService.kt
	BlockingActivity.kt
```

## SQL Rule Authoring Examples

- Continuous usage block:
	- `SELECT * FROM apps WHERE rule_type = 'continuous_usage_rule' AND package_name = 'com.google.android.youtube' AND threshold_minutes = 30 AND interval_minutes = 15 AND action = 'block_app';`
- Inactivity alert rule:
	- `SELECT * FROM apps WHERE rule_type = 'inactivity_rule' AND threshold_minutes = 420 AND interval_minutes = 5 AND alert_type = 'vibration';`
- App dependency rule:
	- `SELECT * FROM apps WHERE rule_type = 'app_dependency_rule' AND trigger_app = 'com.microsoft.vscode' AND restricted_apps IN ('com.instagram.android','com.google.android.youtube');`

## Important Behavior Notes

- `threshold_minutes` in `continuous_usage_rule` means continuous foreground usage time before lock is triggered.
- `interval_minutes` in `continuous_usage_rule` is used as lock duration/cooldown window.
- If `day_of_week` is omitted, all days are treated as active.
- Rule edit and delete are allowed even during an active timeframe; only live toggle-off of an active rule is restricted.

## Required Android Permissions

- `android.permission.PACKAGE_USAGE_STATS`
- `android.permission.SYSTEM_ALERT_WINDOW`
- `android.permission.FOREGROUND_SERVICE`
- `android.permission.FOREGROUND_SERVICE_DATA_SYNC`
- `android.permission.VIBRATE`
- `android.permission.RECEIVE_BOOT_COMPLETED`
- `android.permission.BIND_ACCESSIBILITY_SERVICE`

## Build and Run

```powershell
npm install
npx react-native run-android
```

Release APK:

```powershell
cd android
gradlew assembleRelease
```

Release build + install in one command:

```powershell
Set-Location e:\Products\APK\APK\APK\FocusModeBlocker\android; .\gradlew.bat assembleRelease; adb install -r ".\app\build\outputs\apk\release\app-release.apk"
```

Output APK:

```text
android/app/build/outputs/apk/release/app-release.apk
```
