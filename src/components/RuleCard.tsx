import React from 'react';
import {Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import {isRuleActiveNow} from '../rules/ruleEngine';
import {Rule, WEEK_DAYS} from '../types/models';

type Props = {
  rule: Rule;
  onToggle: (ruleId: string) => void;
  onDelete: (ruleId: string) => void;
  onEdit: (ruleId: string) => void;
};

export function RuleCard({rule, onToggle, onDelete, onEdit}: Props) {
  const isLockedNow = rule.enabled && isRuleActiveNow(rule);
  const days = WEEK_DAYS.filter(day => rule.days.includes(day.value))
    .map(day => day.label)
    .join(', ');

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={styles.info}>
          <Text style={styles.packageName}>{rule.appName || rule.packageName}</Text>
          <Text style={styles.meta}>{rule.packageName}</Text>
          <Text style={styles.meta}>
            {rule.startTime} - {rule.endTime}
          </Text>
          <Text style={styles.meta}>{days || 'No days selected'}</Text>
          {(rule.dailyLimitMinutes ?? 0) > 0 ? (
            <Text style={styles.meta}>Daily Limit: {rule.dailyLimitMinutes} min</Text>
          ) : null}
          {rule.requirePin ? <Text style={styles.meta}>PIN Lock: Enabled</Text> : null}
        </View>
        <Switch
          value={rule.enabled}
          disabled={isLockedNow}
          onValueChange={() => onToggle(rule.id)}
        />
      </View>
      {isLockedNow ? (
        <Text style={styles.lockedHint}>Locked during active time window</Text>
      ) : null}
      <Pressable
        disabled={isLockedNow}
        onPress={() => onToggle(rule.id)}
        style={styles.quickToggleButton}>
        <Text style={[styles.quickToggleText, isLockedNow && styles.quickToggleTextDisabled]}>
          {rule.enabled ? 'Disable Rule' : 'Enable Rule'}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => onEdit(rule.id)}
        style={styles.editButton}>
        <Text style={styles.editText}>Edit Rule</Text>
      </Pressable>

      <Pressable
        onPress={() => onDelete(rule.id)}
        style={styles.deleteButton}>
        <Text style={styles.deleteText}>Delete Rule</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  info: {
    flex: 1,
  },
  packageName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
  },
  meta: {
    marginTop: 4,
    color: '#444',
  },
  quickToggleButton: {
    marginTop: 10,
  },
  quickToggleText: {
    color: '#1d4ed8',
    fontWeight: '600',
  },
  quickToggleTextDisabled: {
    color: '#94a3b8',
  },
  lockedHint: {
    marginTop: 10,
    color: '#b45309',
    fontWeight: '600',
  },
  deleteButton: {
    marginTop: 8,
  },
  editButton: {
    marginTop: 8,
  },
  editText: {
    color: '#0f766e',
    fontWeight: '700',
  },
  deleteText: {
    color: '#dc2626',
    fontWeight: '700',
  },
});
