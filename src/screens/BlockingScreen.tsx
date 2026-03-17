import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

export function BlockingScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Focus Mode Active</Text>
      <Text style={styles.subtitle}>
        This app is blocked until the allowed time.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111827',
    padding: 24,
  },
  title: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 14,
    color: '#d1d5db',
    fontSize: 18,
    textAlign: 'center',
    lineHeight: 26,
  },
});
