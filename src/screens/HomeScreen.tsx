import React from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {RuleCard} from '../components/RuleCard';
import {Rule} from '../types/models';

type Props = {
  rules: Rule[];
  onToggleRule: (ruleId: string) => void;
  onDeleteRule: (ruleId: string) => void;
  onEditRule: (ruleId: string) => void;
};

export function HomeScreen({rules, onToggleRule, onDeleteRule, onEditRule}: Props) {
  return (
    <View>
      <Text style={styles.title}>Active Rules</Text>
      {rules.length === 0 ? (
        <Text style={styles.empty}>No rules yet. Add one in the Add Rule tab.</Text>
      ) : (
        <FlatList
          data={rules}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <RuleCard
              rule={item}
              onToggle={onToggleRule}
              onDelete={onDeleteRule}
              onEdit={onEditRule}
            />
          )}
          scrollEnabled={false}
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
  empty: {
    color: '#555',
  },
});
