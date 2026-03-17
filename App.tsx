import React, {useCallback, useEffect, useState} from 'react';
import {
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {AddRuleScreen} from './src/screens/AddRuleScreen';
import {HomeScreen} from './src/screens/HomeScreen';
import {UsageReportScreen} from './src/screens/UsageReportScreen';
import {getRules, saveRules} from './src/database/rulesStorage';
import {nativeModule, syncRules} from './src/services/nativeBridge';
import {isRuleActiveNow} from './src/rules/ruleEngine';
import {Rule, UsageSummary} from './src/types/models';

type Tab = 'home' | 'add' | 'report';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [rules, setRules] = useState<Rule[]>([]);
  const [usageReport, setUsageReport] = useState<UsageSummary[]>([]);
  const [installedApps, setInstalledApps] = useState<
    {packageName: string; appName: string}[]
  >([]);
  const [usageAccess, setUsageAccess] = useState(false);
  const [overlayAllowed, setOverlayAllowed] = useState(false);
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
  const [uninstallGuardEnabled, setUninstallGuardEnabled] = useState(true);
  const [deviceAdminEnabled, setDeviceAdminEnabled] = useState(false);
  const [hasAppPin, setHasAppPin] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  const refreshPermissions = useCallback(async () => {
    const [usage, overlay, accessibility, adminEnabled, pinConfigured] = await Promise.all([
      nativeModule.hasUsageAccess(),
      nativeModule.canDrawOverlays(),
      nativeModule.isAccessibilityEnabled(),
      nativeModule.isDeviceAdminEnabled(),
      nativeModule.hasAppLockPin(),
    ]);

    setUsageAccess(usage);
    setOverlayAllowed(overlay);
    setAccessibilityEnabled(accessibility);
    setDeviceAdminEnabled(adminEnabled);
    setHasAppPin(pinConfigured);
  }, []);

  const loadData = useCallback(async () => {
    const [savedRules, apps, report, uninstallGuard, adminEnabled, pinConfigured] = await Promise.all([
      getRules(),
      nativeModule.getInstalledApps(),
      nativeModule.getTodayUsageReport(),
      nativeModule.getUninstallProtectionEnabled(),
      nativeModule.isDeviceAdminEnabled(),
      nativeModule.hasAppLockPin(),
    ]);
    setRules(savedRules);
    setInstalledApps(apps);
    setUsageReport(report);
    setUninstallGuardEnabled(uninstallGuard);
    setDeviceAdminEnabled(adminEnabled);
    setHasAppPin(pinConfigured);
    await syncRules(savedRules);

    const hasEnabledRules = savedRules.some(rule => rule.enabled);
    const [usage, accessibility] = await Promise.all([
      nativeModule.hasUsageAccess(),
      nativeModule.isAccessibilityEnabled(),
    ]);

    if (hasEnabledRules && (usage || accessibility)) {
      await nativeModule.startMonitoringService();
    }
  }, []);

  useEffect(() => {
    refreshPermissions();
    loadData();
  }, [loadData, refreshPermissions]);

  async function handleSaveRule(rule: Rule) {
    const latestRules = await getRules();
    const existing = latestRules.find(item => item.id === rule.id);

    const updated = existing
      ? latestRules.map(item => (item.id === rule.id ? rule : item))
      : [...latestRules, rule];
    setRules(updated);
    await saveRules(updated);
    await syncRules(updated);

    const [usage, accessibility] = await Promise.all([
      nativeModule.hasUsageAccess(),
      nativeModule.isAccessibilityEnabled(),
    ]);
    if (updated.some(item => item.enabled) && (usage || accessibility)) {
      await nativeModule.startMonitoringService();
    }

    Alert.alert('Saved', existing ? 'Rule has been updated.' : 'Rule has been added.');
    setEditingRuleId(null);
    setActiveTab('home');
  }

  async function handleToggleRule(ruleId: string) {
    const currentRule = rules.find(rule => rule.id === ruleId);
    if (currentRule && currentRule.enabled && isRuleActiveNow(currentRule)) {
      Alert.alert(
        'Rule Locked',
        'This rule is active right now and cannot be disabled until the time window ends.',
      );
      return;
    }

    const updated = rules.map(rule =>
      rule.id === ruleId ? {...rule, enabled: !rule.enabled} : rule,
    );
    setRules(updated);
    await saveRules(updated);
    await syncRules(updated);

    const hasEnabledRules = updated.some(rule => rule.enabled);
    const [usage, accessibility] = await Promise.all([
      nativeModule.hasUsageAccess(),
      nativeModule.isAccessibilityEnabled(),
    ]);

    if (hasEnabledRules && (usage || accessibility)) {
      await nativeModule.startMonitoringService();
    } else {
      await nativeModule.stopMonitoringService();
    }
  }

  function handleDeleteRule(ruleId: string) {
    const currentRule = rules.find(rule => rule.id === ruleId);
    if (!currentRule) {
      return;
    }

    Alert.alert('Delete Rule', `Delete rule for ${currentRule.appName}?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const updated = rules.filter(rule => rule.id !== ruleId);
          setRules(updated);
          if (editingRuleId === ruleId) {
            setEditingRuleId(null);
          }
          await saveRules(updated);
          await syncRules(updated);

          const hasEnabledRules = updated.some(rule => rule.enabled);
          const [usage, accessibility] = await Promise.all([
            nativeModule.hasUsageAccess(),
            nativeModule.isAccessibilityEnabled(),
          ]);

          if (hasEnabledRules && (usage || accessibility)) {
            await nativeModule.startMonitoringService();
          } else {
            await nativeModule.stopMonitoringService();
          }
        },
      },
    ]);
  }

  function handleEditRule(ruleId: string) {
    const currentRule = rules.find(rule => rule.id === ruleId);
    if (!currentRule) {
      return;
    }

    setEditingRuleId(ruleId);
    setActiveTab('add');
  }

  function handleCancelEditRule() {
    setEditingRuleId(null);
  }

  async function startFocusMode() {
    await syncRules(rules);
    const started = await nativeModule.startMonitoringService();
    Alert.alert(
      started ? 'Focus Mode Started' : 'Start Failed',
      started
        ? 'Foreground monitoring service is running.'
        : 'Unable to start focus mode service.',
    );
  }

  async function stopFocusMode() {
    const stopped = await nativeModule.stopMonitoringService();
    Alert.alert(
      stopped ? 'Focus Mode Stopped' : 'Stop Failed',
      stopped
        ? 'Foreground monitoring service is stopped.'
        : 'Unable to stop focus mode service.',
    );
  }

  async function refreshReport() {
    const report = await nativeModule.getTodayUsageReport();
    setUsageReport(report);
  }

  async function toggleUninstallGuard() {
    const next = !uninstallGuardEnabled;
    const updated = await nativeModule.setUninstallProtectionEnabled(next);
    if (!updated) {
      Alert.alert('Update Failed', 'Unable to change uninstall protection setting.');
      return;
    }

    setUninstallGuardEnabled(next);

    if (next) {
      const adminEnabled = await nativeModule.isDeviceAdminEnabled();
      setDeviceAdminEnabled(adminEnabled);
      if (!adminEnabled) {
        Alert.alert(
          'Stronger Protection Recommended',
          'Enable Device Admin to make uninstall protection harder to bypass.',
          [
            {text: 'Later', style: 'cancel'},
            {
              text: 'Enable Now',
              onPress: async () => {
                await nativeModule.requestDeviceAdminEnable();
              },
            },
          ],
        );
      }
    }
  }

  async function enableDeviceAdmin() {
    await nativeModule.requestDeviceAdminEnable();
  }

  async function saveAppPin() {
    const pin = pinInput.trim();
    if (!/^\d{4}$/.test(pin)) {
      Alert.alert('Invalid PIN', 'PIN must be exactly 4 digits.');
      return;
    }

    const updated = await nativeModule.setAppLockPin(pin);
    if (!updated) {
      Alert.alert('Update Failed', 'Unable to save PIN right now.');
      return;
    }

    setHasAppPin(true);
    setPinInput('');
    setPinModalVisible(false);
    Alert.alert('Saved', 'App PIN has been updated.');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.title}>Focus Mode App Blocker</Text>
        <Text style={styles.subtitle}>Local-only Android 10+ blocker</Text>
      </View>

      {activeTab === 'home' ? (
        <>
          <View style={styles.topActionRow}>
            <Pressable onPress={refreshPermissions} style={styles.refreshTopButton}>
              <Text style={styles.refreshTopButtonText}>Refresh Permission Status</Text>
            </Pressable>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Permissions</Text>
            <View style={styles.permissionRow}>
              <Text style={styles.permissionItem}>
                Usage Access: {usageAccess ? 'Granted' : 'Missing'}
              </Text>
              <Text style={styles.permissionItem}>
                Overlay: {overlayAllowed ? 'Granted' : 'Missing'}
              </Text>
              <Text style={styles.permissionItem}>
                Accessibility: {accessibilityEnabled ? 'Enabled' : 'Disabled'}
              </Text>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Setup & Guards</Text>
            <View style={styles.permissionButtons}>
              <Pressable
                onPress={() => nativeModule.openUsageAccessSettings()}
                style={styles.inlineButton}>
                <Text style={styles.inlineButtonText}>Grant Usage Access</Text>
              </Pressable>
              <Pressable
                onPress={() => nativeModule.openOverlaySettings()}
                style={styles.inlineButton}>
                <Text style={styles.inlineButtonText}>Grant Overlay</Text>
              </Pressable>
              <Pressable
                onPress={() => nativeModule.openAccessibilitySettings()}
                style={styles.inlineButton}>
                <Text style={styles.inlineButtonText}>Enable Accessibility</Text>
              </Pressable>
              <Pressable onPress={toggleUninstallGuard} style={styles.inlineButton}>
                <Text style={styles.inlineButtonText}>
                  Uninstall Guard: {uninstallGuardEnabled ? 'ON' : 'OFF'}
                </Text>
              </Pressable>
              <Pressable onPress={enableDeviceAdmin} style={styles.inlineButton}>
                <Text style={styles.inlineButtonText}>
                  Device Admin: {deviceAdminEnabled ? 'Enabled' : 'Enable'}
                </Text>
              </Pressable>
              <Pressable onPress={() => setPinModalVisible(true)} style={styles.inlineButton}>
                <Text style={styles.inlineButtonText}>
                  App PIN: {hasAppPin ? 'Configured' : 'Set PIN'}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Active Session Control</Text>
            <View style={styles.focusButtonsRow}>
              <Pressable style={styles.primaryButton} onPress={startFocusMode}>
                <Text style={styles.primaryButtonText}>Start Focus Mode</Text>
              </Pressable>
              <Pressable style={styles.stopButton} onPress={stopFocusMode}>
                <Text style={styles.primaryButtonText}>Stop</Text>
              </Pressable>
              <Pressable style={styles.reportButton} onPress={refreshReport}>
                <Text style={styles.primaryButtonText}>Refresh Report</Text>
              </Pressable>
            </View>
          </View>
        </>
      ) : null}

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tabButton, activeTab === 'home' && styles.tabActive]}
          onPress={() => setActiveTab('home')}>
          <Text style={styles.tabText}>Home</Text>
        </Pressable>
        <Pressable
          style={[styles.tabButton, activeTab === 'add' && styles.tabActive]}
          onPress={() => {
            setEditingRuleId(null);
            setActiveTab('add');
          }}>
          <Text style={styles.tabText}>Add Rule</Text>
        </Pressable>
        <Pressable
          style={[styles.tabButton, activeTab === 'report' && styles.tabActive]}
          onPress={() => setActiveTab('report')}>
          <Text style={styles.tabText}>Usage Report</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {activeTab === 'home' && (
          <HomeScreen
            rules={rules}
            onToggleRule={handleToggleRule}
            onDeleteRule={handleDeleteRule}
            onEditRule={handleEditRule}
          />
        )}
        {activeTab === 'add' && (
          <AddRuleScreen
            installedApps={installedApps}
            onSave={handleSaveRule}
            editingRule={rules.find(rule => rule.id === editingRuleId) ?? null}
            onCancelEdit={handleCancelEditRule}
          />
        )}
        {activeTab === 'report' && <UsageReportScreen report={usageReport} />}
      </ScrollView>

      <Modal visible={pinModalVisible} transparent animationType="fade">
        <View style={styles.pinModalBackdrop}>
          <View style={styles.pinModalCard}>
            <Text style={styles.pinModalTitle}>Set 4-digit App PIN</Text>
            <TextInput
              value={pinInput}
              onChangeText={setPinInput}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              style={styles.pinInput}
              placeholder="1234"
            />
            <View style={styles.pinActionsRow}>
              <Pressable style={styles.pinSecondaryButton} onPress={() => setPinModalVisible(false)}>
                <Text style={styles.pinSecondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.pinPrimaryButton} onPress={saveAppPin}>
                <Text style={styles.pinPrimaryButtonText}>Save PIN</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111',
  },
  subtitle: {
    marginTop: 2,
    color: '#555',
  },
  topActionRow: {
    paddingHorizontal: 16,
    marginTop: 10,
    marginBottom: 10,
    alignItems: 'flex-end',
  },
  refreshTopButton: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  refreshTopButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  sectionCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 14,
    backgroundColor: '#ffffff',
    padding: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  permissionRow: {
    marginTop: 0,
    paddingHorizontal: 0,
    gap: 4,
  },
  permissionItem: {
    color: '#1f2937',
    fontWeight: '600',
  },
  permissionButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 0,
    marginTop: 0,
  },
  inlineButton: {
    backgroundColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inlineButtonText: {
    fontSize: 12,
    color: '#111',
    fontWeight: '600',
  },
  focusButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 0,
    marginTop: 0,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  stopButton: {
    backgroundColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportButton: {
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 6,
    gap: 8,
  },
  tabButton: {
    flex: 1,
    backgroundColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#111827',
  },
  tabText: {
    color: '#fff',
    fontWeight: '700',
  },
  content: {
    padding: 16,
    paddingBottom: 24,
  },
  pinModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  pinModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  pinModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
  },
  pinInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111',
    letterSpacing: 2,
  },
  pinActionsRow: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  pinPrimaryButton: {
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  pinPrimaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  pinSecondaryButton: {
    backgroundColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  pinSecondaryButtonText: {
    color: '#111',
    fontWeight: '700',
  },
});

export default App;
