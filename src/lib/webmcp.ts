import { getIncidentContext, type IncidentContext } from "@/lib/incident";

export type WebMCPRegistrationState = "registered" | "unsupported";

const registrations = new WeakMap<Document, Promise<WebMCPRegistrationState>>();

export function registerIncidentContextTool(
  targetDocument: Document,
  readContext: () => IncidentContext = getIncidentContext,
): Promise<WebMCPRegistrationState> {
  if (!targetDocument.modelContext) return Promise.resolve("unsupported");

  const cached = registrations.get(targetDocument);
  if (cached) return cached;

  const registration = targetDocument.modelContext
    .registerTool({
      name: "get_incident_context",
      title: "Get incident context",
      description:
        "Read the current PolicyPilot incident, service health signals, and investigation status.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => readContext(),
    })
    .then(() => "registered" as const)
    .catch((error: unknown) => {
      registrations.delete(targetDocument);
      throw error;
    });

  registrations.set(targetDocument, registration);
  return registration;
}
