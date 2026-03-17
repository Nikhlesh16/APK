import {NativeModules, Platform} from 'react-native';
import {Rule, UsageSummary} from '../types/models';

type InstalledApp = {
  packageName: string;
  appName: string;
};

type FocusModeNativeModule = {
  getInstalledApps: () => Promise<InstalledApp[]>;
  getTodayUsageReport: () => Promise<UsageSummary[]>;
  startMonitoringService: () => Promise<boolean>;
  stopMonitoringService: () => Promise<boolean>;
  hasUsageAccess: () => Promise<boolean>;
  openUsageAccessSettings: () => Promise<void>;
  canDrawOverlays: () => Promise<boolean>;
  openOverlaySettings: () => Promise<void>;
  isAccessibilityEnabled: () => Promise<boolean>;
  openAccessibilitySettings: () => Promise<void>;
  syncRulesToNative: (rulesJson: string) => Promise<boolean>;
  setUninstallProtectionEnabled: (enabled: boolean) => Promise<boolean>;
  getUninstallProtectionEnabled: () => Promise<boolean>;
  isDeviceAdminEnabled: () => Promise<boolean>;
  requestDeviceAdminEnable: () => Promise<boolean>;
  hasAppLockPin: () => Promise<boolean>;
  setAppLockPin: (pin: string) => Promise<boolean>;
};

const noopModule: FocusModeNativeModule = {
  getInstalledApps: async () => [],
  getTodayUsageReport: async () => [],
  startMonitoringService: async () => false,
  stopMonitoringService: async () => false,
  hasUsageAccess: async () => false,
  openUsageAccessSettings: async () => undefined,
  canDrawOverlays: async () => false,
  openOverlaySettings: async () => undefined,
  isAccessibilityEnabled: async () => false,
  openAccessibilitySettings: async () => undefined,
  syncRulesToNative: async () => false,
  setUninstallProtectionEnabled: async () => false,
  getUninstallProtectionEnabled: async () => true,
  isDeviceAdminEnabled: async () => false,
  requestDeviceAdminEnable: async () => false,
  hasAppLockPin: async () => false,
  setAppLockPin: async () => false,
};

const nativeModule: FocusModeNativeModule =
  Platform.OS === 'android'
    ? (NativeModules.FocusModeModule as FocusModeNativeModule)
    : noopModule;

export async function syncRules(rules: Rule[]): Promise<void> {
  await nativeModule.syncRulesToNative(JSON.stringify(rules));
}

export {nativeModule};
export type {InstalledApp};
