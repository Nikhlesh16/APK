import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {WEEK_DAYS, WeekDay} from '../types/models';

type Props = {
  selectedDays: WeekDay[];
  onToggle: (day: WeekDay) => void;
};

export function DaySelector({selectedDays, onToggle}: Props) {
  return (
    <View style={styles.row}>
      {WEEK_DAYS.map(day => {
        const selected = selectedDays.includes(day.value);
        return (
          <Pressable
            key={day.value}
            onPress={() => onToggle(day.value)}
            style={[styles.day, selected && styles.daySelected]}>
            <Text style={[styles.dayText, selected && styles.dayTextSelected]}>
              {day.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  day: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 45,
    alignItems: 'center',
  },
  daySelected: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  dayText: {
    color: '#333',
    fontWeight: '600',
  },
  dayTextSelected: {
    color: '#fff',
  },
});
