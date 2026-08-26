import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import IncidentDashboard from "@/components/incident-dashboard";
import WebMCPStatus from "@/components/webmcp-status";
import { getIncidentContext } from "@/lib/incident";

describe("IncidentDashboard", () => {
  it("shows the seeded incident and all health signals", () => {
    render(<IncidentDashboard incident={getIncidentContext()} />);

    expect(screen.getByRole("heading", { name: /elevated 5xx errors/i })).toBeInTheDocument();
    expect(screen.getByText("INC-1042")).toBeInTheDocument();
    expect(screen.getByText("payments-api")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("WebMCPStatus", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "modelContext");
  });

  it("shows a fallback message when WebMCP is unavailable", async () => {
    render(<WebMCPStatus />);
    expect(await screen.findByText(/webmcp unavailable/i)).toBeInTheDocument();
  });

  it("shows registered after the browser accepts the tool", async () => {
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool: vi.fn().mockResolvedValue(undefined) },
    });

    render(<WebMCPStatus />);

    await waitFor(() => {
      expect(screen.getByText(/tool registered/i)).toBeInTheDocument();
    });
  });
});
