import { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Icon from '../../../../components/icon';
import ScreenHeader from '../../../../components/ScreenHeader';
import Surface from '../../../../components/Surface';
import EmptyState from '../../../../components/EmptyState';
import ErrorState from '../../../../components/ErrorState';
import { useProjects, useProjectCampaigns, useArtifacts } from '../../../../hooks/useProjects';
import { useColors } from '../../../../lib/colors';
import type { Campaign, Artifact } from '../../../../../types';

const TABS = ['campaigns', 'artifacts', 'files', 'settings'] as const;
type Tab = (typeof TABS)[number];

export default function ProjectDetailScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const c = useColors();
  const [tab, setTab] = useState<Tab>('campaigns');

  const { data: projects = [] } = useProjects();
  const project = projects.find(p => p.id === projectId);

  const { data: campaigns = [], isLoading: loadingCampaigns, isError: campaignsError, refetch: refetchCampaigns } = useProjectCampaigns(projectId);
  const { data: artifacts = [], isLoading: loadingArtifacts, isError: artifactsError, refetch: refetchArtifacts } = useArtifacts(projectId);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={project?.name ?? 'Project'} subtitle={project?.description ?? undefined} />

      {/* Tabs */}
      <View className="border-b border-border-soft">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 10 }}
        >
          {TABS.map(t => {
            const active = t === tab;
            return (
              <Text
                key={t}
                onPress={() => setTab(t)}
                className={`capitalize rounded-full px-4 py-2 text-sm font-medium overflow-hidden ${
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                {t}
              </Text>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 10 }}>
        {tab === 'campaigns' && (
          <CampaignList campaigns={campaigns} loading={loadingCampaigns} isError={campaignsError} onRetry={refetchCampaigns} />
        )}
        {tab === 'artifacts' && (
          <ArtifactList artifacts={artifacts} loading={loadingArtifacts} isError={artifactsError} onRetry={refetchArtifacts} iconColor={c.mutedForeground} />
        )}
        {tab === 'files' && (
          <View className="mt-24">
            <EmptyState icon="file-text" title="Files coming soon" description="Browse this project's files here once it's ready." />
          </View>
        )}
        {tab === 'settings' && (
          <View className="mt-24">
            <EmptyState icon="settings" title="Project settings coming soon" description="Manage this project's configuration here once it's ready." />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function CampaignList({ campaigns, loading, isError, onRetry }: { campaigns: Campaign[]; loading: boolean; isError: boolean; onRetry: () => void }) {
  if (loading) return <ActivityIndicator className="mt-8" />;
  if (isError) {
    return (
      <View className="mt-24">
        <ErrorState onRetry={onRetry} />
      </View>
    );
  }
  if (campaigns.length === 0) {
    return (
      <View className="mt-24">
        <EmptyState icon="git-merge" title="No campaigns yet" description="Campaigns for this project will show up here." />
      </View>
    );
  }
  return (
    <>
      {campaigns.map(item => (
        <Surface key={item.id} className="p-4 gap-1">
          <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{item.name}</Text>
          <Text className="text-xs text-muted-foreground capitalize">{item.status}</Text>
        </Surface>
      ))}
    </>
  );
}

function ArtifactList({ artifacts, loading, isError, onRetry, iconColor }: { artifacts: Artifact[]; loading: boolean; isError: boolean; onRetry: () => void; iconColor: string }) {
  if (loading) return <ActivityIndicator className="mt-8" />;
  if (isError) {
    return (
      <View className="mt-24">
        <ErrorState onRetry={onRetry} />
      </View>
    );
  }
  if (artifacts.length === 0) {
    return (
      <View className="mt-24">
        <EmptyState icon="file-text" title="No artifacts yet" description="Artifacts produced in this project will show up here." />
      </View>
    );
  }
  return (
    <>
      {artifacts.map(item => (
        <Surface key={item.id} className="flex-row items-center gap-3 p-4">
          <View className="h-9 w-9 items-center justify-center rounded-md bg-muted">
            <Icon name="file-text" size={16} color={iconColor} />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{item.name}</Text>
            <Text className="text-xs text-muted-foreground mt-0.5 capitalize">{item.type}</Text>
          </View>
        </Surface>
      ))}
    </>
  );
}
