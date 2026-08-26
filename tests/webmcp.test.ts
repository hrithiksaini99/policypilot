import { describe, expect, it, vi } from "vitest";
import { getIncidentContext } from "@/lib/incident";
import { registerIncidentContextTool } from "@/lib/webmcp";

describe("registerIncidentContextTool", () => {
  it("reports unsupported without throwing when WebMCP is unavailable", async () => {
    const result = await registerIncidentContextTool({} as Document);
    expect(result).toBe("unsupported");
  });

  it("registers a read-only get_incident_context tool", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    const targetDocument = { modelContext: { registerTool } } as unknown as Document;

    await expect(registerIncidentContextTool(targetDocument)).resolves.toBe("registered");
    expect(registerTool).toHaveBeenCalledOnce();

    const tool = registerTool.mock.calls[0][0];
    expect(tool).toMatchObject({
      name: "get_incident_context",
      title: "Get incident context",
      description: "Read the current PolicyPilot incident, service health signals, and investigation status.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    });
    await expect(tool.execute({})).resolves.toEqual(getIncidentContext());
  });

  it("uses the provided reader when the page owns newer state", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    const targetDocument = { modelContext: { registerTool } } as unknown as Document;
    const readContext = vi.fn(() => ({ ...getIncidentContext(), status: "mitigated" as const }));

    await registerIncidentContextTool(targetDocument, readContext);
    const tool = registerTool.mock.calls[0][0];

    await expect(tool.execute({})).resolves.toMatchObject({ status: "mitigated" });
    expect(readContext).toHaveBeenCalledOnce();
  });
});
