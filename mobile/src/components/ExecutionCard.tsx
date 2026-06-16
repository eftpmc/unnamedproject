import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import Icon, { type IconName } from './icon';
import StatusPill, { type PillStatus } from './StatusPill';
import { useColors } from '../lib/colors';
import type { Execution } from '../../types';


const TOOL_ICON: Array<[RegExp, IconName]> = [
  [/claude|codex|mcp|agent/i, 'cpu'],
  [/github|pull/i, 'git-pull-request'],
  [/git/i, 'git-branch'],
  [/file|read|write|artifact/i, 'file-text'],
  [/project|code|query/i, 'code'],
];

function toolIcon(tool: string): IconName {
  return TOOL_ICON.find(([re]) => re.test(tool))?.[1] ?? 'terminal';
}

function formatToolName(tool: string): string {
  return tool
    .replace(/^invoke_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

export default function ExecutionCard({ execution }: { execution: Execution }) {
  const c = useColors();
  const [expanded, setExpanded] = useState(false);
  const status = execution.status as PillStatus;
  const isApproval = status === 'awaiting_approval';
  const output = execution.outputLog || execution.result || '';
  const iconName = toolIcon(execution.tool);

  return (
    <View
      className={`mx-4 my-1 overflow-hidden rounded-lg border bg-card ${isApproval ? 'border-warning' : 'border-border-soft'}`}
    >
      <TouchableOpacity
        className="flex-row items-center gap-2.5 px-3.5 py-3"
        onPress={() => output && setExpanded(e => !e)}
        activeOpacity={output ? 0.6 : 1}
      >
        <View className="h-7 w-7 items-center justify-center rounded-md bg-muted">
          <Icon name={iconName} size={14} color={c.mutedForeground} />
        </View>
        <View className="flex-1 min-w-0">
          <Text className="text-xs font-medium text-foreground" numberOfLines={1}>{formatToolName(execution.tool)}</Text>
          {execution.projectName ? (
            <Text className="text-[11px] text-faint-fg" numberOfLines={1}>{execution.projectName}</Text>
          ) : null}
        </View>
        <StatusPill status={status} />
        {output ? (
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={c.faintFg} />
        ) : null}
      </TouchableOpacity>

      {expanded && !!output && (
        <View className="border-t border-border-soft bg-muted">
          <ScrollView className="max-h-44 px-3.5 py-3" nestedScrollEnabled>
            <Text className="font-mono text-[12px] leading-5 text-muted-foreground">{output}</Text>
          </ScrollView>
        </View>
      )}
    </View>
  );
}
