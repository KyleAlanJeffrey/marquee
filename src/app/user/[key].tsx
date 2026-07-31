import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { ErrorState } from '@/components/error-state';
import { PageMeta } from '@/components/page-meta';
import { PersonProfile } from '@/components/person-profile';
import { StageBackground } from '@/components/stage-background';
import { TopBar } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import { personLabel, useProfile } from '@/lib/people';

/**
 * Somebody's profile at a shareable URL. The body is `PersonProfile`, the same
 * component the Profile tab renders for yourself — this screen only adds the
 * chrome and the document title. Loading and error states live in the component.
 */
export default function ProfileScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  // Same query key as the component's own read — one fetch serves both.
  const profile = useProfile(key ?? '');
  const label = profile.data ? personLabel(profile.data.user) : 'Profile';

  // No key means no query ever fires (`enabled: !!key`), which would render as
  // a spinner that never resolves. Say what's actually wrong instead.
  if (!key) {
    return (
      <View style={{ flex: 1 }}>
        <StageBackground />
        <TopBar />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ErrorState message="No profile named. Follow a link to somebody, or open your own from the Profile tab." />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <PageMeta title={label} description={`${label} on Marquee — concerts, follows and reviews.`} />
      <StageBackground />
      <TopBar />
      <ScrollView
        contentContainerStyle={{ padding: Spacing.three, paddingBottom: Spacing.six }}
        showsVerticalScrollIndicator={false}>
        <PersonProfile profileKey={key} />
      </ScrollView>
    </View>
  );
}
