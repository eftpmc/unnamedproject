import { createPlan, type DbPlanStep } from '../db/index.js';

interface CreatePlanStepInput {
  title: string;
  agent: DbPlanStep['agent'];
  prompt?: string | null;
  depends_on?: number[];
  tool_args?: Record<string, unknown> | null;
}

interface CreatePlanInput {
  project_id: string;
  title: string;
  steps: CreatePlanStepInput[];
  session_id?: string;
}

export function runCreatePlan(
  input: CreatePlanInput,
  userId: string
): string {
  const { plan, steps } = createPlan(
    input.project_id,
    input.session_id ?? null,
    input.title,
    input.steps,
  );
  return JSON.stringify({
    plan_id: plan.id,
    project_id: plan.project_id,
    steps: steps.map((s: DbPlanStep) => ({
      id: s.id,
      title: s.title,
      agent: s.agent,
      depends_on: s.depends_on ? JSON.parse(s.depends_on) : [],
    })),
  });
}
