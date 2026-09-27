// MaterialIcons stand in for SF Symbols on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight } from 'expo-symbols';
import React from 'react';
import { OpaqueColorValue, StyleProp, ViewStyle } from 'react-native';

// SF Symbol name -> MaterialIcons name (https://icons.expo.fyi).
const MAPPING = {
  'gearshape.fill': 'settings',
  'checkmark.circle.fill': 'check-circle',
  checklist: 'checklist',
  'list.bullet.rectangle.portrait': 'list-alt',
  'doc.text.magnifyingglass': 'find-in-page',
} as Partial<
  Record<
    Extract<import('expo-symbols').SymbolViewProps['name'], string>,
    React.ComponentProps<typeof MaterialIcons>['name']
  >
>;

export type IconSymbolName = keyof typeof MAPPING;

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
