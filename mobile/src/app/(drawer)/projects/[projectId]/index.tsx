import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useProjectCampaigns, useArtifacts } from '../../../../hooks/useProjects';

const TABS = ['campaigns', 'artifacts', 'files', 'settings'] as const;

export default function ProjectDetailScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const router = useRouter();
  const { data: campaigns = [] } = useProjectCampaigns(projectId);
  const { data: artifacts = [] } = useArtifacts(projectId);

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="px-4 pt-4 gap-4">
        <View className="flex-row flex-wrap gap-2">
          {TABS.map(tab => (
            <TouchableOpacity
              key={tab}
              className="bg-muted rounded-lg px-4 py-2"
              onPress={() => router.push(`/(drawer)/projects/${projectId}/${tab}`)}
            >
              <Text className="text-foreground capitalize text-sm font-medium">{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Campaigns ({campaigns.length})
          </Text>
          {campaigns.slice(0, 3).map(c => (
            <View key={c.id} className="bg-muted rounded-lg px-3 py-2">
              <Text className="text-foreground text-sm">{c.name}</Text>
              <Text className="text-muted-foreground text-xs">{c.status}</Text>
            </View>
          ))}
        </View>

        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Artifacts ({artifacts.length})
          </Text>
          {artifacts.slice(0, 3).map(a => (
            <View key={a.id} className="bg-muted rounded-lg px-3 py-2">
              <Text className="text-foreground text-sm">{a.name}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
