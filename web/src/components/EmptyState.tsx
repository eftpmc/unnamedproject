import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface EmptyStateProps {
  onNewChat: () => void;
}

export default function EmptyState({ onNewChat }: EmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <Card className="w-full max-w-md rounded-3xl border-border/60 bg-background/72 text-center shadow-sm">
        <CardHeader>
          <CardTitle>Start a chat</CardTitle>
          <CardDescription>Talk to the agent to plan, execute, and manage work across your projects.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onNewChat}>New chat</Button>
        </CardContent>
      </Card>
    </div>
  );
}
