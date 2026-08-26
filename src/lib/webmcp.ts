import { getIncidentContext, type IncidentContext } from "@/lib/incident";

export type WebMCPRegistrationState = "registered" | "unsupported";

export async function registerIncidentContextTool(
  targetDocument: Document,
  readContext: () => IncidentContext = getIncidentContext,
): Promise<WebMCPRegistrationState> {
  if (!targetDocument.modelContext) return "unsupported";

  await targetDocument.modelContext.registerTool({
    name: "get_incident_context",
    title: "Get incident context",
    description: "Read the current PolicyPilot incident, service health signals, and investigation status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async () => readContext(),
  });

  return "registered";
}
