import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import IncidentDashboard from "@/components/incident-dashboard";
import WebMCPStatus from "@/components/webmcp-status";
import { getIncidentContext } from "@/lib/incident";

afterEach(cleanup);

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

  it("announces the unsupported state as a status region", async () => {
    render(<WebMCPStatus />);

    await screen.findByText(/webmcp unavailable/i);
    expect(screen.getByRole("status")).toHaveTextContent(/webmcp unavailable/i);
  });
});

describe("Home page heading order", () => {
  it("opens the outline with the incident summary as the level-1 heading", () => {
    render(<Home />);

    const summaryHeading = screen.getByRole("heading", { level: 1 });
    expect(summaryHeading).toHaveTextContent(/elevated 5xx errors/i);
    expect(screen.getAllByRole("heading")[0]).toBe(summaryHeading);
    expect(screen.getByText("Human authority. Agent speed.")).not.toHaveRole("heading");
  });
});
