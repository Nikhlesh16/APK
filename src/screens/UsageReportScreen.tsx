import React, {useMemo, useState} from 'react';
import {FlatList, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {formatDuration} from '../rules/ruleEngine';
import {applyUsageReportSqlQuery} from '../rules/sqlUsageReportParser';
import {UsageSummary} from '../types/models';

type Props = {
  report: UsageSummary[];
};

function formatEventTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatTimeRange(startTimestamp: number, endTimestamp: number): string {
  return `${formatEventTime(startTimestamp)} - ${formatEventTime(endTimestamp)}`;
}

export function UsageReportScreen({report}: Props) {
  const [sqlQuery, setSqlQuery] = useState(
    'SELECT * FROM usage_report ORDER BY total_duration DESC;',
  );
  const [sqlError, setSqlError] = useState('');
  const [appliedQuery, setAppliedQuery] = useState(
    'SELECT * FROM usage_report ORDER BY total_duration DESC;',
  );

  const queriedReport = useMemo(() => {
    try {
      return applyUsageReportSqlQuery(report, appliedQuery);
    } catch {
      return [...report].sort((a, b) => b.totalDuration - a.totalDuration);
    }
  }, [report, appliedQuery]);

  const totalDuration = queriedReport.reduce((sum, item) => sum + item.totalDuration, 0);
  const totalSessions = queriedReport.reduce((sum, item) => sum + item.timeline.length, 0);

  function applyQuery() {
    try {
      applyUsageReportSqlQuery(report, sqlQuery);
      setSqlError('');
      setAppliedQuery(sqlQuery);
    } catch (error) {
      setSqlError(error instanceof Error ? error.message : 'Invalid SQL query.');
    }
  }

  function resetQuery() {
    const defaultQuery = 'SELECT * FROM usage_report ORDER BY total_duration DESC;';
    setSqlQuery(defaultQuery);
    setAppliedQuery(defaultQuery);
    setSqlError('');
  }

  return (
    <View>
      <Text style={styles.title}>Usage Report (Today)</Text>

      <Text style={styles.sqlLabel}>SQL Query</Text>
      <TextInput
        value={sqlQuery}
        onChangeText={setSqlQuery}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        textAlignVertical="top"
        style={styles.sqlInput}
      />
      <Text style={styles.sqlHelpText}>
        Supported: SELECT * FROM usage_report WHERE ... ORDER BY ... LIMIT ...
      </Text>
      <Text style={styles.sqlHelpText}>
        WHERE supports: package_name, app_name, app_name LIKE '%text%', total_minutes, sessions.
      </Text>
      <View style={styles.sqlActionRow}>
        <Pressable style={styles.sqlApplyButton} onPress={applyQuery}>
          <Text style={styles.sqlApplyButtonText}>Apply Query</Text>
        </Pressable>
        <Pressable style={styles.sqlResetButton} onPress={resetQuery}>
          <Text style={styles.sqlResetButtonText}>Reset</Text>
        </Pressable>
      </View>
      {sqlError ? <Text style={styles.sqlErrorText}>{sqlError}</Text> : null}

      {queriedReport.length > 0 && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Total Screen Time</Text>
            <Text style={styles.summaryValue}>{formatDuration(totalDuration)}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Tracked Apps</Text>
            <Text style={styles.summaryValue}>{queriedReport.length}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Total Sessions</Text>
            <Text style={styles.summaryValue}>{totalSessions}</Text>
          </View>
        </View>
      )}

      {queriedReport.length === 0 ? (
        <Text style={styles.empty}>No usage events found for today.</Text>
      ) : (
        <FlatList
          data={queriedReport}
          keyExtractor={item => item.packageName}
          scrollEnabled={false}
          renderItem={({item, index}) => (
            <View style={styles.card}>
              <View style={styles.appHeaderRow}>
                <Text style={styles.rank}>#{index + 1}</Text>
                <Text style={styles.appName}>{item.appName}</Text>
              </View>
              <Text style={styles.packageName}>{item.packageName}</Text>

              <View style={styles.metricsRow}>
                <Text style={styles.metric}>Total: {formatDuration(item.totalDuration)}</Text>
                <Text style={styles.metric}>Sessions: {item.timeline.length}</Text>
              </View>

              <View style={styles.timelineHeaderRow}>
                <Text style={styles.timelineHeaderLabel}>Time</Text>
                <Text style={styles.timelineHeaderLabel}>Duration</Text>
              </View>

              {item.timeline
                .slice()
                .sort((a, b) => a.startTimestamp - b.startTimestamp)
                .map(event => (
                  <View
                    key={`${event.startTimestamp}-${event.endTimestamp}`}
                    style={styles.timelineRow}>
                    <Text style={styles.timelineValue}>
                      {formatTimeRange(event.startTimestamp, event.endTimestamp)}
                    </Text>
                    <Text style={styles.timelineDuration}>
                      {formatDuration(event.duration)}
                    </Text>
                  </View>
                ))}
            </View>
          )}
        />
      )}
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
  sqlLabel: {
    marginBottom: 6,
    color: '#222',
    fontWeight: '700',
  },
  sqlInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    minHeight: 96,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#0f172a',
    fontFamily: 'monospace',
  },
  sqlHelpText: {
    marginTop: 4,
    color: '#475569',
    fontSize: 12,
  },
  sqlActionRow: {
    marginTop: 8,
    marginBottom: 6,
    flexDirection: 'row',
    gap: 8,
  },
  sqlApplyButton: {
    backgroundColor: '#0f766e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sqlApplyButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  sqlResetButton: {
    backgroundColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sqlResetButtonText: {
    color: '#111827',
    fontWeight: '700',
  },
  sqlErrorText: {
    marginBottom: 8,
    color: '#dc2626',
    fontWeight: '600',
  },
  summaryCard: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  summaryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    color: '#475569',
    fontWeight: '600',
  },
  summaryValue: {
    color: '#111827',
    fontWeight: '800',
  },
  empty: {
    color: '#555',
  },
  card: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 12,
    marginBottom: 12,
  },
  appHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rank: {
    backgroundColor: '#1d4ed8',
    color: '#fff',
    fontWeight: '700',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  appName: {
    fontWeight: '700',
    color: '#111',
  },
  packageName: {
    marginTop: 4,
    color: '#666',
  },
  metricsRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metric: {
    color: '#1d4ed8',
    fontWeight: '700',
  },
  timelineHeaderRow: {
    marginTop: 10,
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingBottom: 6,
  },
  timelineHeaderLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  timelineRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timelineValue: {
    color: '#222',
  },
  timelineDuration: {
    color: '#111827',
    fontWeight: '600',
  },
});
