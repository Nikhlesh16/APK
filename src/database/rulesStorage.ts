import AsyncStorage from '@react-native-async-storage/async-storage';
import {isRuleActiveNow} from '../rules/ruleEngine';
import {Rule} from '../types/models';

const RULES_KEY = 'focus_mode_rules';

export async function getRules(): Promise<Rule[]> {
  const raw = await AsyncStorage.getItem(RULES_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Rule[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveRules(rules: Rule[]): Promise<void> {
  await AsyncStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

export async function upsertRule(newRule: Rule): Promise<Rule[]> {
  const rules = await getRules();
  const index = rules.findIndex(rule => rule.id === newRule.id);

  if (index >= 0) {
    rules[index] = newRule;
  } else {
    rules.push(newRule);
  }

  await saveRules(rules);
  return rules;
}

export async function toggleRule(ruleId: string): Promise<Rule[]> {
  const rules = await getRules();
  const currentRule = rules.find(rule => rule.id === ruleId);
  if (currentRule && currentRule.enabled && isRuleActiveNow(currentRule)) {
    throw new Error('Rule is active and cannot be disabled right now.');
  }

  const updated = rules.map(rule =>
    rule.id === ruleId ? {...rule, enabled: !rule.enabled} : rule,
  );
  await saveRules(updated);
  return updated;
}

export async function deleteRule(ruleId: string): Promise<Rule[]> {
  const rules = await getRules();
  const updated = rules.filter(rule => rule.id !== ruleId);
  await saveRules(updated);
  return updated;
}
