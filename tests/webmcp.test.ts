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

    const { execute, ...metadata } = registerTool.mock.calls[0][0];
    expect(metadata).toEqual({
      name: "get_incident_context",
      title: "Get incident context",
      description: "Read the current PolicyPilot incident, service health signals, and investigation status.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    });
    await expect(execute({})).resolves.toEqual(getIncidentContext());
  });

  it("uses the provided reader when the page owns newer state", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    const targetDocument = { modelContext: { registerTool } } as unknown as Document;
    const produced: unknown[] = [];
    const readContext = vi.fn(() => {
      const next = { ...getIncidentContext(), status: "mitigated" as const };
      produced.push(next);
      return next;
    });

    await registerIncidentContextTool(targetDocument, readContext);
    const tool = registerTool.mock.calls[0][0];

    await expect(tool.execute({})).resolves.toBe(produced[0]);
    await expect(tool.execute({})).resolves.toBe(produced[1]);

    expect(readContext).toHaveBeenCalledTimes(2);
    expect(produced[0]).not.toBe(produced[1]);
  });

  it("registers only once for repeated calls on the same document", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    const targetDocument = { modelContext: { registerTool } } as unknown as Document;

    await expect(registerIncidentContextTool(targetDocument)).resolves.toBe("registered");
    await expect(registerIncidentContextTool(targetDocument)).resolves.toBe("registered");

    expect(registerTool).toHaveBeenCalledOnce();
  });

  it("shares one in-flight registration across concurrent calls on the same document", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registerTool = vi.fn(() => gate.then(() => undefined));
    const targetDocument = { modelContext: { registerTool } } as unknown as Document;

    const pending = Promise.all([
      registerIncidentContextTool(targetDocument),
      registerIncidentContextTool(targetDocument),
    ]);
    release();
    const [first, second] = await pending;

    expect(first).toBe("registered");
    expect(second).toBe("registered");
    expect(registerTool).toHaveBeenCalledOnce();
  });

  it("clears its cache after a rejected registration so a later retry can succeed", async () => {
    const registerTool = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("duplicate tool"))
      .mockResolvedValueOnce(undefined);
    const targetDocument = { modelContext: { registerTool } } as unknown as Document;

    await expect(registerIncidentContextTool(targetDocument)).rejects.toThrow("duplicate tool");

    await expect(registerIncidentContextTool(targetDocument)).resolves.toBe("registered");
    expect(registerTool).toHaveBeenCalledTimes(2);
  });
});
