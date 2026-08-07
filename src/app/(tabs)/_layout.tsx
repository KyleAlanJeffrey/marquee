import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      // Walk the visit history on back. The default treats every navigation
      // between tab-navigator screens as a jump with no way back, which
      // turned every detail page's chevron into "go to Explore" the moment
      // the detail routes moved in here.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        // Opaque so switching tabs repaints cleanly on web (no bleed-through).
        sceneStyle: { backgroundColor: theme.background },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textTertiary,
        tabBarStyle: {
          backgroundColor: 'rgba(14,14,14,0.92)',
          borderTopColor: theme.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontFamily: Fonts.label, fontSize: 11, letterSpacing: 0.5 },
      }}>
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'compass' : 'compass-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="following"
        options={{
          title: 'Following',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'heart' : 'heart-outline'} size={size} color={color} />
          ),
        }}
      />
      {/* One tab for everything you've marked: going, interested, saved, and
          your lists. It grew out of "Saved" when RSVPs and shelves arrived and
          each needed a home — this is the home. */}
      <Tabs.Screen
        name="saved"
        options={{
          title: 'My Shows',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'bookmark' : 'bookmark-outline'} size={size} color={color} />
          ),
        }}
      />
      {/* The social stream — what other people saw and what they're going to.
          It took the Log tab's slot (Letterboxd's exact consolidation: the
          diary lives on your profile, the friends feed gets the tab), because
          a feed nobody can find is a feed nobody reads, and this one used to
          live three scrolls deep inside Profile. */}
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'pulse' : 'pulse-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
          ),
        }}
      />
      {/* The detail pages live inside the tab navigator so the bottom bar
          never drops out — an app that loses its chrome on every tap reads as
          a website. `href: null` keeps them out of the bar itself, and the
          group segment keeps them off the URL, so /event/[id] et al stay the
          exact paths the sitemap and every shared link already use. */}
      <Tabs.Screen name="artist/[id]" options={{ href: null }} />
      <Tabs.Screen name="event/[id]" options={{ href: null }} />
      <Tabs.Screen name="venue/[id]" options={{ href: null }} />
      <Tabs.Screen name="user/[key]" options={{ href: null }} />
      <Tabs.Screen name="list/[id]" options={{ href: null }} />
      <Tabs.Screen name="browse" options={{ href: null }} />
      <Tabs.Screen name="map" options={{ href: null }} />
    </Tabs>
  );
}
