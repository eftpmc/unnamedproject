import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import Icon from './icon';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import { useProjectTree, useProjectFile, type FileEntry } from '../hooks/useProjects';
import { useColors } from '../lib/colors';

interface Props {
  projectId: string;
}

const INDENT = 16;

function TreeRow({
  projectId,
  entry,
  depth,
  selectedPath,
  onSelectFile,
}: {
  projectId: string;
  entry: FileEntry;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const { data, isFetching } = useProjectTree(projectId, entry.path, entry.type === 'dir' && open);
  const paddingLeft = 12 + depth * INDENT;

  if (entry.type === 'file') {
    const active = selectedPath === entry.path;
    return (
      <TouchableOpacity
        className={`flex-row items-center gap-2 py-2.5 pr-3 ${active ? 'bg-muted' : ''}`}
        style={{ paddingLeft }}
        onPress={() => onSelectFile(entry.path)}
        activeOpacity={0.6}
      >
        <Icon name="file-text" size={15} color={c.faintFg} />
        <Text className={`flex-1 text-sm ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`} numberOfLines={1}>
          {entry.name}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View>
      <TouchableOpacity
        className="flex-row items-center gap-2 py-2.5 pr-3"
        style={{ paddingLeft }}
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.6}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={c.faintFg} />
        <Icon name={open ? 'folder-open' : 'folder'} size={15} color={c.onAccentSoft} />
        <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>{entry.name}</Text>
        {isFetching && <ActivityIndicator size="small" color={c.faintFg} />}
      </TouchableOpacity>
      {open && data?.entries?.map(child => (
        <TreeRow
          key={child.path}
          projectId={projectId}
          entry={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
        />
      ))}
    </View>
  );
}

function FileViewer({ projectId, filePath, onBack }: { projectId: string; filePath: string; onBack: () => void }) {
  const c = useColors();
  const { data, isLoading, isError, refetch } = useProjectFile(projectId, filePath);

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-2 border-b border-border-soft px-2 h-11">
        <TouchableOpacity className="h-9 w-9 items-center justify-center rounded-lg" onPress={onBack} activeOpacity={0.6} accessibilityLabel="Back to files">
          <Icon name="chevron-left" size={20} color={c.fgSoft} />
        </TouchableOpacity>
        <Text className="flex-1 font-mono text-xs text-muted-foreground" numberOfLines={1}>{filePath}</Text>
      </View>
      {isLoading ? (
        <ActivityIndicator className="mt-8" color={c.primary} />
      ) : isError ? (
        <ErrorState title="Couldn't open file" onRetry={refetch} />
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
          <Text className="font-mono text-xs leading-5 text-muted-foreground">{data?.content}</Text>
        </ScrollView>
      )}
    </View>
  );
}

export default function ProjectFiles({ projectId }: Props) {
  const c = useColors();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useProjectTree(projectId, '');

  if (selectedPath) {
    return <FileViewer projectId={projectId} filePath={selectedPath} onBack={() => setSelectedPath(null)} />;
  }

  if (isLoading) return <ActivityIndicator className="mt-8" color={c.primary} />;
  if (isError) return <ErrorState onRetry={refetch} />;

  const entries = data?.entries ?? [];
  if (entries.length === 0) {
    return (
      <View className="mt-24">
        <EmptyState icon="file-text" title="No files yet" description="Files will appear here once this project's workspace has content." />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ paddingVertical: 8 }}>
      {entries.map(entry => (
        <TreeRow
          key={entry.path}
          projectId={projectId}
          entry={entry}
          depth={0}
          selectedPath={selectedPath}
          onSelectFile={setSelectedPath}
        />
      ))}
    </ScrollView>
  );
}
