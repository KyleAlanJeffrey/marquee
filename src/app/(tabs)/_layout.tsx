import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, Tabs } from 'expo-router';
import { Pressable } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: theme.tint }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Following',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="star" size={size} color={color} />
          ),
          headerRight: () => (
            <Link href="/search" asChild>
              <Pressable hitSlop={8} style={{ marginRight: Spacing.three }}>
                <Ionicons name="add-circle" size={28} color={theme.tint} />
              </Pressable>
            </Link>
          ),
        }}
      />
      <Tabs.Screen
        name="near-me"
        options={{
          title: 'Near Me',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-sharp" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
