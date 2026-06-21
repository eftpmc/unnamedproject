import { Button } from '@/components/ui/button';

export default function EmptyChatState({
  projectName,
  disabled,
  onSelect,
}: {
  projectName?: string;
  disabled: boolean;
  onSelect: (content: string) => void;
}) {
  const prompts = projectName
    ? [
        `Give me a quick orientation to ${projectName}.`,
        `Review the current state of ${projectName} and suggest next steps.`,
        `Find the highest-impact UI/UX improvements for ${projectName}.`,
      ]
    : [
        'Help me plan the next useful step.',
        'Review this app and suggest the highest-impact improvements.',
        'Start by asking me the fewest questions needed to get moving.',
      ];

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-xl text-center">
        <div className="text-sm font-semibold text-foreground">
          {projectName ? `Start with ${projectName}` : 'Start a chat'}
        </div>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          Ask for a plan, a review, or a concrete change. The agent will keep tool work and project context attached to this conversation.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {prompts.map(prompt => (
            <Button
              key={prompt}
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onSelect(prompt)}
              className="h-auto whitespace-normal justify-start rounded-xl px-3 py-2 text-left text-xs font-normal"
            >
              {prompt}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
