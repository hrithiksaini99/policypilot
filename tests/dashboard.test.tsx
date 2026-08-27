import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import IncidentDashboard from "@/components/incident-dashboard";
import WebMCPStatus from "@/components/webmcp-status";
import AgentActivity from "@/components/agent-activity";
import { getIncidentContext } from "@/lib/incident";
import { policyPilotRuntime } from "@/lib/operations";

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
      expect(screen.getByText(/3 tools registered/i)).toBeInTheDocument();
    });
  });

  it("lists all three exact tool names when registered", async () => {
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool: vi.fn().mockResolvedValue(undefined) },
    });

    render(<WebMCPStatus />);

    await waitFor(() => {
      expect(screen.getByText("get_incident_context")).toBeInTheDocument();
      expect(screen.getByText("list_recent_deploys")).toBeInTheDocument();
      expect(screen.getByText("propose_rollback")).toBeInTheDocument();
    });
  });

  it("announces the unsupported state as a status region", async () => {
    render(<WebMCPStatus />);

    await screen.findByText(/webmcp unavailable/i);
    expect(screen.getByRole("status")).toHaveTextContent(/webmcp unavailable/i);
  });
});

describe("AgentActivity", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "modelContext");
    policyPilotRuntime.reset();
  });

  it("shows empty activity state and reset control without WebMCP", async () => {
    render(<AgentActivity />);

    expect(await screen.findByText(/connected agents can inspect context/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset demo/i })).toBeInTheDocument();
    expect(screen.queryByText(/awaiting human approval/i)).not.toBeInTheDocument();
  });

  it("updates the feed with success and error events when runtime methods are invoked", async () => {
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool: vi.fn().mockResolvedValue(undefined) },
    });

    render(<AgentActivity />);

    await waitFor(() => {
      expect(screen.getByText(/connected agents can inspect context/i)).toBeInTheDocument();
    });

    await policyPilotRuntime.readIncident();
    await waitFor(() => {
      expect(screen.getByText(/get_incident_context/i)).toBeInTheDocument();
      expect(screen.getByText(/success/i)).toBeInTheDocument();
    });

    try {
      policyPilotRuntime.proposeRollback({ deploymentId: "invalid" });
    } catch {
      // expected error for invalid input
    }
    await waitFor(() => {
      expect(screen.getByText(/propose_rollback/i)).toBeInTheDocument();
      expect(screen.getByText(/INVALID_ROLLBACK_INPUT/i)).toBeInTheDocument();
    });
  });

  it("shows the exact approval preview when a valid proposal exists", async () => {
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool: vi.fn().mockResolvedValue(undefined) },
    });

    render(<AgentActivity />);

    await policyPilotRuntime.proposeRollback({ deploymentId: "DEP-8821" });
    await waitFor(() => {
      expect(screen.getByText(/awaiting human approval/i)).toBeInTheDocument();
      expect(screen.getByText("DEP-8821")).toBeInTheDocument();
      expect(screen.getByText("checkout-v2")).toBeInTheDocument();
      expect(screen.getByText("checkout-v1")).toBeInTheDocument();
      expect(screen.getByText(/human approval is still required/i)).toBeInTheDocument();
      expect(screen.getByText(/cannot execute/i)).toBeInTheDocument();
    });
  });

  it("reset clears the activity feed and proposal preview", async () => {
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool: vi.fn().mockResolvedValue(undefined) },
    });

    render(<AgentActivity />);

    await policyPilotRuntime.proposeRollback({ deploymentId: "DEP-8821" });
    await waitFor(() => {
      expect(screen.getByText(/awaiting human approval/i)).toBeInTheDocument();
    });

    const resetButton = screen.getByRole("button", { name: /reset demo/i });
    resetButton.click();

    await waitFor(() => {
      expect(screen.getByText(/connected agents can inspect context/i)).toBeInTheDocument();
      expect(screen.queryByText(/awaiting human approval/i)).not.toBeInTheDocument();
      expect(screen.queryByText("DEP-8821")).not.toBeInTheDocument();
    });
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

  it("shows Day 2 label instead of Day 1", () => {
    render(<Home />);
    expect(screen.getByText(/PolicyPilot \/ Day 2/i)).toBeInTheDocument();
  });

  it("includes the agent activity section below the top grid", () => {
    render(<Home />);
    expect(screen.getByText(/agent activity/i)).toBeInTheDocument();
  });
});