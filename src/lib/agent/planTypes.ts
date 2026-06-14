export interface PlanStep {
  file: string;
  action: "edit" | "create" | "delete";
  description: string;
}

export interface ParsedPlan {
  title: string;
  steps: PlanStep[];
  rawXml: string;
}

export function parsePlan(content: string): ParsedPlan | null {
  const match = content.match(/<origin-plan>([\s\S]*?)<\/origin-plan>/);
  if (!match) return null;
  const inner = match[1];
  const titleMatch = inner.match(/<title>([\s\S]*?)<\/title>/);
  const stepMatches = [...inner.matchAll(/<step\s+file="([^"]+)"\s+action="([^"]+)">([\s\S]*?)<\/step>/g)];
  if (stepMatches.length === 0) return null;
  return {
    title: titleMatch?.[1]?.trim() ?? "Proposed changes",
    steps: stepMatches.map(m => ({
      file: m[1].trim(),
      action: m[2].trim() as "edit" | "create" | "delete",
      description: m[3].trim(),
    })),
    rawXml: match[0],
  };
}
