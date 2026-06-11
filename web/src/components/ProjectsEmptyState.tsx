import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ProjectsEmptyState() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <Card className="w-full max-w-md rounded-3xl border-border/60 bg-background/72 text-center shadow-sm">
        <CardHeader>
          <CardTitle>Your projects</CardTitle>
          <CardDescription>Set up a project in Settings to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => navigate('/settings')}>Go to Settings</Button>
        </CardContent>
      </Card>
    </div>
  );
}
