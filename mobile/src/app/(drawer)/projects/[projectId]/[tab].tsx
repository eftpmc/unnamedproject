import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useProjectCampaigns, useArtifacts } from '../../../../hooks/useProjects';

export default function ProjectTabScreen() {
  const { projectId, tab } = useLocalSearchParams<{ projectId: string; tab: string }>();
  const { data: campaigns = [], isLoading: loadingCampaigns } = useProjectCampaigns(projectId);
  const { data: artifacts = [], isLoading: loadingArtifacts } = useArtifacts(projectId);

  if (tab === 'campaigns') {
    return (
      <ScrollView className="flex-1 bg-background">
        <View className="p-4 gap-3">
          <Text className="text-foreground font-bold text-base">Campaigns</Text>
          {loadingCampaigns ? <ActivityIndicator /> : campaigns.map(c => (
            <View key={c.id} className="bg-muted rounded-xl p-4 gap-1">
              <Text className="text-foreground font-medium">{c.name}</Text>
              <Text className="text-muted-foreground text-xs capitalize">{c.status}</Text>
            </View>
          ))}
          {!loadingCampaigns && campaigns.length === 0 && (
            <Text className="text-muted-foreground text-sm">No campaigns</Text>
          )}
        </View>
      </ScrollView>
    );
  }

  if (tab === 'artifacts') {
    return (
      <ScrollView className="flex-1 bg-background">
        <View className="p-4 gap-3">
          <Text className="text-foreground font-bold text-base">Artifacts</Text>
          {loadingArtifacts ? <ActivityIndicator /> : artifacts.map(a => (
            <View key={a.id} className="bg-muted rounded-xl p-4">
              <Text className="text-foreground font-medium">{a.name}</Text>
              <Text className="text-muted-foreground text-xs">{a.type}</Text>
            </View>
          ))}
          {!loadingArtifacts && artifacts.length === 0 && (
            <Text className="text-muted-foreground text-sm">No artifacts</Text>
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <View className="flex-1 bg-background items-center justify-center">
      <Text className="text-muted-foreground capitalize">{tab} — coming soon</Text>
    </View>
  );
}
