# FocusModeBlocker – Project Handoff

This document is for moving the project to another machine and quickly understanding/running it.

## 1) What this app does

A local-only Android Focus Mode app blocker built with React Native + Kotlin native services.

Core behavior:
- Users create app-blocking rules (package, time range, days, enabled).
- Native services detect foreground app.
- If current app matches an active rule, app shows blocking screen:
  - "Focus Mode Active. This app is blocked until the allowed time."
- Usage report is generated from Android `UsageStatsManager`.

No backend/cloud is used.

---

## 2) High-level architecture

### React Native layer
- UI, rule management, persistence, and bridge calls to native Android.
- Rules are stored locally in AsyncStorage.

### Native Android layer (Kotlin)
- Foreground service + accessibility service monitor app switches.
- Shared rule evaluator decides whether an app is blocked now.
- Blocking activity is launched immediately when rule matches.

---

## 3) Key file structure

### Root
- `App.tsx` – main app shell, tabs, permissions status, starts/stops monitor service.
- `package.json` – scripts and dependencies.
- `README.md` – setup and build instructions.

### React Native source (`src/`)
- `src/types/models.ts`
  - `Rule`, `UsageRecord`, `UsageSummary`, weekday constants.
- `src/database/rulesStorage.ts`
  - AsyncStorage CRUD for rules.
- `src/services/nativeBridge.ts`
  - JS → native module bridge (`FocusModeModule`).
- `src/rules/ruleEngine.ts`
  - JS helper utilities for formatting and local rule checks.
- `src/screens/HomeScreen.tsx`
  - Active rules list and toggles.
- `src/screens/AddRuleScreen.tsx`
  - Add rule form + installed app picker.
- `src/screens/UsageReportScreen.tsx`
  - Daily usage summary + timeline.
- `src/screens/BlockingScreen.tsx`
  - RN-side blocking UI component (native blocking uses `BlockingActivity`).
- `src/components/RuleCard.tsx`
  - Rule display card with enable/disable.
- `src/components/DaySelector.tsx`
  - Day-of-week selector chips.

### Android native (`android/app/src/main/...`)
- `java/com/focusmodeblocker/FocusModeModule.kt`
  - Native module methods exposed to RN:
    - installed apps, permissions checks, start/stop monitoring service,
    - usage report, sync rules to native storage.
- `java/com/focusmodeblocker/FocusModePackage.kt`
  - Registers the native module package.
- `java/com/focusmodeblocker/ForegroundMonitorService.kt`
  - Foreground polling loop (`UsageStatsManager`) and blocking activity launch.
- `java/com/focusmodeblocker/FocusAccessibilityService.kt`
  - Real-time foreground app detection on window changes.
- `java/com/focusmodeblocker/RuleEvaluator.kt`
  - Shared native rule engine (time/day/overnight handling).
- `java/com/focusmodeblocker/BlockingActivity.kt`
  - Fullscreen block screen activity.
- `AndroidManifest.xml`
  - Permissions, services, activities, accessibility metadata.
- `res/xml/accessibility_service_config.xml`
  - Accessibility service config.
- `res/layout/activity_blocking.xml`
  - Native blocking screen layout.
- `res/values/strings.xml`
  - app strings.

---

## 4) Required Android permissions/components

Declared in `android/app/src/main/AndroidManifest.xml`:
- `android.permission.PACKAGE_USAGE_STATS`
- `android.permission.SYSTEM_ALERT_WINDOW`
- `android.permission.FOREGROUND_SERVICE`
- `android.permission.BIND_ACCESSIBILITY_SERVICE`

Also includes:
- `ForegroundMonitorService`
- `FocusAccessibilityService`
- `BlockingActivity`
- App visibility `queries` for launcher apps.

Important: usage/accessibility/overlay must be manually granted on device.

---

## 5) Local data model

### Rule
- `id`
- `packageName`
- `appName`
- `startTime` (`HH:mm`)
- `endTime` (`HH:mm`)
- `days` (`0..6`, Sun..Sat)
- `enabled`

### UsageRecord
- `packageName`
- `appName`
- `startTimestamp`
- `endTimestamp`
- `duration`

---

## 6) Rule blocking flow (runtime)

1. User adds/toggles rule in RN.
2. Rule saved in AsyncStorage.
3. Rules synced to native shared prefs (`rules_json`).
4. Native monitor service and accessibility service detect foreground app.
5. `RuleEvaluator` checks if app + day + current time match an enabled rule.
6. If blocked, `BlockingActivity` opens immediately.

---

## 7) Move to personal computer (zip handoff checklist)

After unzip:
1. Install Node.js LTS (and npm).
2. Install Android SDK/JDK tools (Android Studio or command-line SDK + JDK 17).
3. Open project folder in VS Code.
4. Run:
   - `npm install`
5. Ensure these are configured:
   - `JAVA_HOME`
   - `ANDROID_SDK_ROOT`
   - `platform-tools` in PATH

If your C drive is low on space, use:
- `GRADLE_USER_HOME` on a larger drive
- `TEMP` and `TMP` on larger drive

---

## 8) Instant USB development workflow (recommended)

This avoids reinstall for most JS/UI changes.

Terminal A:
- `cd <project-root>`
- `npm start`

Terminal B:
- `cd <project-root>`
- `npx react-native run-android`

Phone setup:
- Enable Developer Options
- Enable USB Debugging
- Verify with `adb devices`

Now edit JS/TS files and save -> Fast Refresh updates instantly.

Rebuild/reinstall required only for:
- Kotlin/Java/native code changes
- AndroidManifest changes
- Gradle/dependency changes

---

## 9) Final APK build

From project root:
- `cd android`
- `gradlew assembleRelease`

APK output:
- `android/app/build/outputs/apk/release/app-release.apk`

---

## 10) Quick troubleshooting

### App not blocking
- Check all 3 permissions are granted in app UI:
  - Usage Access
  - Overlay
  - Accessibility
- Ensure rule is enabled and time/day currently matches.
- Ensure package name is exact.

### Build fails with "not enough space"
- Free disk or redirect:
  - `GRADLE_USER_HOME`
  - `TEMP`
  - `TMP`

### Build fails with Java errors
- Verify:
  - `java -version`
  - `JAVA_HOME` points to JDK 17+

---

## 11) AI agent context prompt (copy-paste)

Use this on the new machine when asking another agent:

"This is a React Native Android app with native Kotlin services for app blocking.
Please read PROJECT_HANDOFF.md and then inspect App.tsx, src/services/nativeBridge.ts,
android/app/src/main/java/com/focusmodeblocker/FocusModeModule.kt,
ForegroundMonitorService.kt, FocusAccessibilityService.kt, RuleEvaluator.kt,
and AndroidManifest.xml before making changes."
