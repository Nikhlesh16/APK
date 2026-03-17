import React, {useEffect, useMemo, useState} from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import {DaySelector} from '../components/DaySelector';
import {InstalledApp} from '../services/nativeBridge';
import {buildSqlFromRule, parseSqlToRules} from '../rules/sqlRuleParser';
import {Rule, WeekDay} from '../types/models';

type Props = {
  installedApps: InstalledApp[];
  onSave: (rule: Rule) => Promise<void>;
  editingRule?: Rule | null;
  onCancelEdit?: () => void;
};

type RuleBlock =
  | 'condition_time'
  | 'condition_days'
  | 'condition_usage'
  | 'action_pin'
  | 'action_block';

function padTimeInput(value: string): string {
  const clean = value.replace(/[^0-9:]/g, '').slice(0, 5);
  const [h = '00', m = '00'] = clean.split(':');
  const hour = Math.min(23, Math.max(0, Number(h) || 0));
  const minute = Math.min(59, Math.max(0, Number(m) || 0));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function timeStringToDate(value: string): Date {
  const [hour, minute] = padTimeInput(value)
    .split(':')
    .map(part => Number(part) || 0);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

function formatDateToTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

export function AddRuleScreen({installedApps, onSave, editingRule, onCancelEdit}: Props) {
  const [builderMode, setBuilderMode] = useState<'visual' | 'sql'>('visual');
  const [packageName, setPackageName] = useState('');
  const [appName, setAppName] = useState('');
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime] = useState('06:00');
  const [dailyLimitMinutes, setDailyLimitMinutes] = useState('');
  const [requirePin, setRequirePin] = useState(false);
  const [days, setDays] = useState<WeekDay[]>([0, 1, 2, 3, 4, 5, 6]);
  const [isAppModalVisible, setAppModalVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end' | null>(
    null,
  );
  const [enabledBlocks, setEnabledBlocks] = useState<RuleBlock[]>([
    'condition_time',
    'condition_days',
    'action_block',
  ]);
  const [sqlQuery, setSqlQuery] = useState(
    "SELECT * FROM apps WHERE package_name = 'com.instagram.android' AND day_of_week IN ('MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY') AND time BETWEEN '22:00' AND '06:00' AND usage_minutes >= 60 AND require_pin = TRUE;",
  );
  const [sqlError, setSqlError] = useState('');

  useEffect(() => {
    if (!editingRule) {
      return
    }

    setPackageName(editingRule.packageName);
    setAppName(editingRule.appName);
    setStartTime(editingRule.startTime);
    setEndTime(editingRule.endTime);
    setDays(editingRule.days);
    setDailyLimitMinutes(
      (editingRule.dailyLimitMinutes ?? 0) > 0
        ? String(editingRule.dailyLimitMinutes)
        : '',
    );
    setRequirePin(!!editingRule.requirePin);

    const nextBlocks: RuleBlock[] = ['action_block'];
    if (editingRule.startTime !== '00:00' || editingRule.endTime !== '00:00') {
      nextBlocks.push('condition_time');
    }
    if (editingRule.days.length > 0 && editingRule.days.length < 7) {
      nextBlocks.push('condition_days');
    }
    if ((editingRule.dailyLimitMinutes ?? 0) > 0) {
      nextBlocks.push('condition_usage');
    }
    if (editingRule.requirePin) {
      nextBlocks.push('action_pin');
    }
    setEnabledBlocks(nextBlocks);
    setSqlQuery(buildSqlFromRule(editingRule));
  }, [editingRule]);

  const availableApps = useMemo(
    () => [...installedApps].sort((a, b) => a.appName.localeCompare(b.appName)),
    [installedApps],
  );

  function toggleDay(day: WeekDay) {
    setDays(prev =>
      prev.includes(day) ? prev.filter(item => item !== day) : [...prev, day],
    );
  }

  function hasBlock(block: RuleBlock): boolean {
    return enabledBlocks.includes(block);
  }

  function toggleBlock(block: RuleBlock) {
    if (block === 'action_block') {
      return;
    }

    const isActive = enabledBlocks.includes(block);
    if (block === 'action_pin') {
      setRequirePin(!isActive);
    }

    setEnabledBlocks(prev =>
      prev.includes(block)
        ? prev.filter(item => item !== block)
        : [...prev, block],
    );
  }

  function applyTemplate(template: 'night' | 'usage' | 'strict') {
    if (template === 'night') {
      setEnabledBlocks(['condition_time', 'condition_days', 'action_block']);
      setStartTime('23:00');
      setEndTime('06:00');
      setDays([0, 1, 2, 3, 4, 5, 6]);
      setDailyLimitMinutes('');
      setRequirePin(false);
      return;
    }

    if (template === 'usage') {
      setEnabledBlocks(['condition_usage', 'action_block']);
      setDailyLimitMinutes('60');
      setStartTime('00:00');
      setEndTime('00:00');
      setDays([0, 1, 2, 3, 4, 5, 6]);
      setRequirePin(false);
      return;
    }

    setEnabledBlocks([
      'condition_time',
      'condition_days',
      'condition_usage',
      'action_pin',
      'action_block',
    ]);
    setStartTime('22:00');
    setEndTime('06:00');
    setDays([0, 1, 2, 3, 4, 5, 6]);
    setDailyLimitMinutes('45');
    setRequirePin(true);
  }

  async function saveRule() {
    if (builderMode === 'sql') {
      try {
        setSqlError('');
        const parsedRules = parseSqlToRules(sqlQuery, {
          editingRule,
          fallbackPackageName: packageName.trim() || undefined,
          fallbackAppName: appName.trim() || undefined,
        });

        for (const parsedRule of parsedRules) {
          await onSave(parsedRule);
        }

        if (!editingRule) {
          setSqlQuery(
            "SELECT * FROM apps WHERE package_name = 'com.instagram.android' AND day_of_week IN ('MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY') AND time BETWEEN '22:00' AND '06:00' AND usage_minutes >= 60 AND require_pin = TRUE;",
          );
        }

        return;
      } catch (error) {
        setSqlError(error instanceof Error ? error.message : 'Invalid SQL query.');
        return;
      }
    }

    if (!packageName.trim()) {
      return;
    }

    const rule: Rule = {
      id: editingRule?.id ?? `${Date.now()}`,
      packageName: packageName.trim(),
      appName: appName.trim() || packageName.trim(),
      startTime: hasBlock('condition_time') ? padTimeInput(startTime) : '00:00',
      endTime: hasBlock('condition_time') ? padTimeInput(endTime) : '00:00',
      days: hasBlock('condition_days')
        ? ([...days].sort((a, b) => a - b) as WeekDay[])
        : ([0, 1, 2, 3, 4, 5, 6] as WeekDay[]),
      enabled: editingRule?.enabled ?? true,
      dailyLimitMinutes: hasBlock('condition_usage')
        ? Math.max(0, Number(dailyLimitMinutes) || 0)
        : 0,
      requirePin: hasBlock('action_pin') && requirePin,
    };

    await onSave(rule);
    setPackageName('');
    setAppName('');
    setStartTime('00:00');
    setEndTime('06:00');
    setDailyLimitMinutes('');
    setRequirePin(false);
    setDays([0, 1, 2, 3, 4, 5, 6]);
    setEnabledBlocks(['condition_time', 'condition_days', 'action_block']);
  }

  function onTimeChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (event.type === 'dismissed' || !selectedDate || !pickerTarget) {
      setPickerTarget(null);
      return;
    }

    const selectedTime = formatDateToTime(selectedDate);
    if (pickerTarget === 'start') {
      setStartTime(selectedTime);
    } else {
      setEndTime(selectedTime);
    }
    setPickerTarget(null);
  }

  return (
    <View>
      <Text style={styles.title}>Add Rule</Text>
      <View style={styles.modeRow}>
        <Pressable
          onPress={() => setBuilderMode('visual')}
          style={[
            styles.modeChip,
            builderMode === 'visual' && styles.modeChipActive,
          ]}>
          <Text
            style={[
              styles.modeChipText,
              builderMode === 'visual' && styles.modeChipTextActive,
            ]}>
            Visual Builder
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setBuilderMode('sql')}
          style={[styles.modeChip, builderMode === 'sql' && styles.modeChipActive]}>
          <Text
            style={[
              styles.modeChipText,
              builderMode === 'sql' && styles.modeChipTextActive,
            ]}>
            SQL Mode
          </Text>
        </Pressable>
      </View>
      {editingRule ? (
        <View style={styles.editModeRow}>
          <Text style={styles.editModeText}>Editing existing rule</Text>
          <Pressable onPress={onCancelEdit}>
            <Text style={styles.editCancelText}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
      {builderMode === 'visual' ? (
        <>
          <Text style={styles.label}>Select App</Text>
          <Pressable
            style={styles.selector}
            onPress={() => setAppModalVisible(true)}>
            <Text style={styles.selectorText}>
              {appName || packageName || 'Choose installed app'}
            </Text>
          </Pressable>

          <Text style={styles.label}>Package Name</Text>
          <TextInput
            value={packageName}
            onChangeText={setPackageName}
            style={styles.input}
            placeholder="com.android.chrome"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Rule Blocks</Text>
          <View style={styles.blocksRow}>
            <Pressable
              style={[styles.blockChip, hasBlock('condition_time') && styles.blockChipActive]}
              onPress={() => toggleBlock('condition_time')}>
              <Text
                style={[
                  styles.blockChipText,
                  hasBlock('condition_time') && styles.blockChipTextActive,
                ]}>
                Time
              </Text>
            </Pressable>
            <Pressable
              style={[styles.blockChip, hasBlock('condition_days') && styles.blockChipActive]}
              onPress={() => toggleBlock('condition_days')}>
              <Text
                style={[
                  styles.blockChipText,
                  hasBlock('condition_days') && styles.blockChipTextActive,
                ]}>
                Days
              </Text>
            </Pressable>
            <Pressable
              style={[styles.blockChip, hasBlock('condition_usage') && styles.blockChipActive]}
              onPress={() => toggleBlock('condition_usage')}>
              <Text
                style={[
                  styles.blockChipText,
                  hasBlock('condition_usage') && styles.blockChipTextActive,
                ]}>
                Usage Limit
              </Text>
            </Pressable>
            <Pressable
              style={[styles.blockChip, hasBlock('action_pin') && styles.blockChipActive]}
              onPress={() => toggleBlock('action_pin')}>
              <Text
                style={[
                  styles.blockChipText,
                  hasBlock('action_pin') && styles.blockChipTextActive,
                ]}>
                PIN
              </Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Quick Templates</Text>
          <View style={styles.blocksRow}>
            <Pressable style={styles.templateChip} onPress={() => applyTemplate('night')}>
              <Text style={styles.templateChipText}>Night Focus</Text>
            </Pressable>
            <Pressable style={styles.templateChip} onPress={() => applyTemplate('usage')}>
              <Text style={styles.templateChipText}>Usage Cap</Text>
            </Pressable>
            <Pressable style={styles.templateChip} onPress={() => applyTemplate('strict')}>
              <Text style={styles.templateChipText}>Strict Lock</Text>
            </Pressable>
          </View>

          {hasBlock('condition_time') ? (
            <>
              <Text style={styles.label}>Start Time</Text>
              <Pressable
                style={styles.selector}
                onPress={() => setPickerTarget('start')}>
                <Text style={styles.selectorText}>{startTime}</Text>
              </Pressable>

              <Text style={styles.label}>End Time</Text>
              <Pressable style={styles.selector} onPress={() => setPickerTarget('end')}>
                <Text style={styles.selectorText}>{endTime}</Text>
              </Pressable>
            </>
          ) : null}

          {hasBlock('condition_days') ? (
            <>
              <Text style={styles.label}>Days</Text>
              <DaySelector selectedDays={days} onToggle={toggleDay} />
            </>
          ) : null}

          {hasBlock('condition_usage') ? (
            <>
              <Text style={styles.label}>Daily Limit (minutes)</Text>
              <TextInput
                value={dailyLimitMinutes}
                onChangeText={setDailyLimitMinutes}
                style={styles.input}
                placeholder="e.g. 60"
                keyboardType="number-pad"
              />
            </>
          ) : null}

          {hasBlock('action_pin') ? (
            <View style={styles.switchRow}>
              <Text style={styles.labelInline}>Require 4-digit PIN to open this app</Text>
              <Switch value={requirePin} onValueChange={setRequirePin} />
            </View>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.label}>SQL Query (Standard SQL style)</Text>
          <Text style={styles.sqlHelpText}>
            Use SELECT ... FROM apps WHERE ... with AND-combined predicates.
          </Text>
          <TextInput
            value={sqlQuery}
            onChangeText={setSqlQuery}
            style={styles.sqlInput}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            textAlignVertical="top"
          />
          <Text style={styles.sqlHelpText}>
            Supported fields: package_name, app_name, day_of_week IN (...), time BETWEEN 'HH:MM' AND 'HH:MM', threshold_minutes = N, interval_minutes = N, usage_minutes &gt;= N, require_pin = TRUE/FALSE, action = 'block_app', enabled = TRUE/FALSE.
          </Text>
          <Text style={styles.sqlHelpText}>
            Continuous usage example: SELECT * FROM apps WHERE rule_type = 'continuous_usage_rule' AND package_name = 'com.instagram.android' AND threshold_minutes = 45 AND interval_minutes = 30 AND action = 'block_app' AND enabled = TRUE;
          </Text>
          <Text style={styles.sqlHelpText}>
            Phone unlock mode: SELECT * FROM apps WHERE phone_unlock_choice_mode = TRUE AND live_free = TRUE;
          </Text>
          <Text style={styles.sqlHelpText}>
            Inactivity mode: SELECT * FROM apps WHERE rule_type = 'inactivity_rule' AND threshold_minutes = 420 AND interval_minutes = 5 AND alert_type = 'vibration';
          </Text>
          <Text style={styles.sqlHelpText}>
            App dependency mode: SELECT * FROM apps WHERE rule_type = 'app_dependency_rule' AND trigger_app = 'com.microsoft.vscode' AND restricted_apps IN ('com.instagram.android','com.google.android.youtube');
          </Text>
          {sqlError ? <Text style={styles.sqlErrorText}>{sqlError}</Text> : null}
        </>
      )}

      <Pressable style={styles.saveButton} onPress={saveRule}>
        <Text style={styles.saveButtonText}>{editingRule ? 'Update Rule' : 'Save Rule'}</Text>
      </Pressable>

      {builderMode === 'visual' && pickerTarget ? (
        <DateTimePicker
          value={
            pickerTarget === 'start'
              ? timeStringToDate(startTime)
              : timeStringToDate(endTime)
          }
          mode="time"
          is24Hour={true}
          display="default"
          onChange={onTimeChange}
        />
      ) : null}

      <Modal visible={builderMode === 'visual' && isAppModalVisible} animationType="slide">
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Installed Apps</Text>
          <FlatList
            data={availableApps}
            keyExtractor={item => item.packageName}
            renderItem={({item}) => (
              <Pressable
                onPress={() => {
                  setPackageName(item.packageName);
                  setAppName(item.appName);
                  setAppModalVisible(false);
                }}
                style={styles.appRow}>
                <Text style={styles.appName}>{item.appName}</Text>
                <Text style={styles.appPackage}>{item.packageName}</Text>
              </Pressable>
            )}
          />
          <Pressable
            onPress={() => setAppModalVisible(false)}
            style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    color: '#111',
  },
  editModeRow: {
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editModeText: {
    color: '#0f766e',
    fontWeight: '700',
  },
  editCancelText: {
    color: '#1d4ed8',
    fontWeight: '700',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  modeChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
  },
  modeChipActive: {
    backgroundColor: '#0f766e',
  },
  modeChipText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 12,
  },
  modeChipTextActive: {
    color: '#ffffff',
  },
  label: {
    marginTop: 10,
    marginBottom: 6,
    color: '#222',
    fontWeight: '600',
  },
  selector: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  selectorText: {
    color: '#333',
  },
  blocksRow: {
    marginTop: 4,
    marginBottom: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  blockChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
  },
  blockChipActive: {
    backgroundColor: '#2563eb',
  },
  blockChipText: {
    color: '#111',
    fontWeight: '700',
    fontSize: 12,
  },
  blockChipTextActive: {
    color: '#fff',
  },
  templateChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#dbeafe',
  },
  templateChipText: {
    color: '#1e3a8a',
    fontWeight: '700',
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111',
    backgroundColor: '#fff',
  },
  sqlInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    minHeight: 180,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#0f172a',
    fontFamily: 'monospace',
  },
  sqlHelpText: {
    color: '#475569',
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 18,
  },
  sqlErrorText: {
    color: '#dc2626',
    fontWeight: '600',
    marginTop: 4,
  },
  saveButton: {
    marginTop: 16,
    backgroundColor: '#111827',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  modalContainer: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },
  appRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 12,
  },
  appName: {
    color: '#111',
    fontWeight: '600',
  },
  appPackage: {
    color: '#666',
    marginTop: 4,
  },
  closeButton: {
    marginTop: 8,
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#e5e7eb',
  },
  closeButtonText: {
    fontWeight: '700',
  },
  switchRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  labelInline: {
    color: '#222',
    fontWeight: '600',
    flex: 1,
  },
});
