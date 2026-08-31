import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import IncidentDashboard from "@/components/incident-dashboard";
import WebMCPStatus from "@/components/webmcp-status";
import AgentActivity from "@/components/agent-activity";
import LiveIncidentDashboard from "@/components/live-incident-dashboard";
import PolicyApproval from "@/components/policy-approval";
import { getIncidentContext } from "@/lib/incident";
import { getHealthyIncidentContext } from "@/lib/scenario";
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
      expect(screen.getByText(/5 tools registered/i)).toBeInTheDocument();
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

  it("shows Day 4 label", () => {
    render(<Home />);
    expect(screen.getByText(/PolicyPilot \/ Day 4/i)).toBeInTheDocument();
  });

  it("includes the agent activity section below the top grid", () => {
    render(<Home />);
    expect(screen.getByText(/agent activity/i)).toBeInTheDocument();
  });
});

function prepareApprovedRollback(runtime: typeof policyPilotRuntime) {
  runtime.proposeRollback({ deploymentId: "DEP-8821" });
  const approval = runtime.approveCurrentProposal();
  return { approvalId: approval.approvalId, actionHash: approval.actionHash };
}

describe("LiveIncidentDashboard", () => {
  afterEach(() => {
    policyPilotRuntime.reset();
  });

  it("shows the initial investigating incident", async () => {
    render(<LiveIncidentDashboard />);

    expect(await screen.findByText(/elevated 5xx errors/i)).toBeInTheDocument();
    expect(screen.getByText("INC-1042")).toBeInTheDocument();
    expect(screen.getByText("investigating")).toBeInTheDocument();
  });

  it("updates incident health after approved tool execution", async () => {
    const approval = prepareApprovedRollback(policyPilotRuntime);
    render(<LiveIncidentDashboard />);
    policyPilotRuntime.executeApprovedRollback(approval);

    expect(await screen.findByText(/5xx errors stabilized after approved rollback/i)).toBeInTheDocument();
    expect(screen.getByText("mitigated")).toBeInTheDocument();
  });
});

describe("PolicyApproval", () => {
  afterEach(() => {
    policyPilotRuntime.reset();
  });

  it("shows initial copy when no proposal exists", async () => {
    render(<PolicyApproval />);

    expect(await screen.findByText(/inspect and draft are allowed/i)).toBeInTheDocument();
    expect(screen.getByText(/rollback execution requires human approval/i)).toBeInTheDocument();
  });

  it("opens an exact-action human approval dialog", async () => {
    policyPilotRuntime.proposeRollback({ deploymentId: "DEP-8821" });
    render(<PolicyApproval />);
    await screen.getByRole("button", { name: /review and approve rollback/i }).click();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("DEP-8821");
    expect(dialog).toHaveTextContent("checkout-v2");
    expect(dialog).toHaveTextContent("checkout-v1");
    expect(dialog).toHaveTextContent("fnv1a-32:rollback-inc-1042-dep-8821-checkout-v2-checkout-v1");
  });

  it("approval makes execution available but does not execute", async () => {
    policyPilotRuntime.proposeRollback({ deploymentId: "DEP-8821" });
    render(<PolicyApproval />);
    await screen.getByRole("button", { name: /review and approve rollback/i }).click();
    await screen.getByRole("button", { name: /approve exact rollback/i }).click();

    expect(await screen.findByText(/execution available/i)).toBeInTheDocument();
    expect(policyPilotRuntime.getSnapshot().currentExecution).toBeNull();
  });
});

describe("Healthy scenario dashboard", () => {
  afterEach(() => {
    policyPilotRuntime.reset();
  });

  it("renders IncidentDashboard with healthy incident (emerald badge, correct signals)", () => {
    const healthyIncident = getHealthyIncidentContext();
    render(<IncidentDashboard incident={healthyIncident} />);

    expect(screen.getByRole("heading", { name: /payments-api operating normally/i })).toBeInTheDocument();
    expect(screen.getByText("OPS-HEALTHY-0001")).toBeInTheDocument();
    expect(screen.getByText("payments-api")).toBeInTheDocument();
    expect(screen.getByText("INFO")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();

    const statusBadge = screen.getByText("Healthy").closest("span");
    expect(statusBadge).toHaveClass("bg-emerald-500/15");
    expect(statusBadge).toHaveClass("text-emerald-300");
    expect(statusBadge).toHaveClass("ring-emerald-500/40");

    const signalItems = screen.getAllByRole("listitem");
    expect(signalItems).toHaveLength(2);
    expect(screen.getByText("5xx rate stable at 0.4%")).toBeInTheDocument();
    expect(screen.getByText("Latency p95 stable at 220ms")).toBeInTheDocument();
  });

  it("PolicyApproval shows only policy explanation in healthy scenario (no approval UI)", () => {
    policyPilotRuntime.selectScenario("healthy");
    render(<PolicyApproval />);

    expect(screen.getByText("System healthy; no mutation justified. Rollback not permitted.")).toBeInTheDocument();
    expect(screen.queryByText(/human approval required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/action fingerprint/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /review and approve rollback/i })).not.toBeInTheDocument();
  });

  it("AgentActivity shows healthy empty state message", () => {
    policyPilotRuntime.selectScenario("healthy");
    render(<AgentActivity />);

    expect(screen.getByText("System healthy. No agent activity recorded.")).toBeInTheDocument();
    expect(screen.queryByText(/connected agents can inspect context/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset demo/i })).toBeInTheDocument();
  });

  it("reset in healthy scenario preserves healthy state", () => {
    policyPilotRuntime.selectScenario("healthy");
    render(<AgentActivity />);

    const resetButton = screen.getByRole("button", { name: /reset demo/i });
    resetButton.click();

    expect(screen.getByText("System healthy. No agent activity recorded.")).toBeInTheDocument();
    expect(policyPilotRuntime.getSnapshot().incident.status).toBe("healthy");
    expect(policyPilotRuntime.getSnapshot().recentDeployments[0].deploymentId).toBe("DEP-9900");
  });
});

describe("Day 4: Five semantic tool cards", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "modelContext");
    policyPilotRuntime.reset();
  });

  const setupRegistered = () => {
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool: vi.fn().mockResolvedValue(undefined) },
    });
  };

  it("renders five semantic cards (not chips) after registration", async () => {
    setupRegistered();
    render(<WebMCPStatus />);

    await waitFor(() => {
      expect(screen.getByText(/5 tools registered/i)).toBeInTheDocument();
    });

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(5);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows exact tool names and descriptions from WebMCP metadata", async () => {
    setupRegistered();
    render(<WebMCPStatus />);

    await waitFor(() => {
      expect(screen.getByText(/5 tools registered/i)).toBeInTheDocument();
    });

    expect(screen.getByText("get_incident_context")).toBeInTheDocument();
    expect(screen.getByText("Read the current PolicyPilot incident, service health signals, and investigation status.")).toBeInTheDocument();

    expect(screen.getByText("list_recent_deploys")).toBeInTheDocument();
    expect(screen.getByText("List recent payments-api deployments and identify the active suspect rollout related to the incident.")).toBeInTheDocument();

    expect(screen.getByText("get_policy_state")).toBeInTheDocument();
    expect(screen.getByText("Read the current PolicyPilot guardrail state and whether rollback execution is available.")).toBeInTheDocument();

    expect(screen.getByText("propose_rollback")).toBeInTheDocument();
    expect(screen.getByText("Prepare a non-executing rollback preview for the active suspect deployment; human approval is still required.")).toBeInTheDocument();

    expect(screen.getByText("execute_approved_rollback")).toBeInTheDocument();
    expect(screen.getByText("Execute the exact simulated rollback only when a human-approved approval ID and action fingerprint match the pending proposal.")).toBeInTheDocument();
  });

  it("shows READ badge for three read-only tools and MUTATE for two mutating tools", async () => {
    setupRegistered();
    render(<WebMCPStatus />);

    await waitFor(() => {
      expect(screen.getByText(/5 tools registered/i)).toBeInTheDocument();
    });

    const readBadges = screen.getAllByText("READ");
    expect(readBadges).toHaveLength(3);

    const mutateBadges = screen.getAllByText("MUTATE");
    expect(mutateBadges).toHaveLength(2);
  });

  it("shows availability: three read tools always Available in incident scenario", async () => {
    setupRegistered();
    policyPilotRuntime.selectScenario("incident");
    render(<WebMCPStatus />);

    await waitFor(() => {
      expect(screen.getByText(/5 tools registered/i)).toBeInTheDocument();
    });

    const cards = screen.getAllByRole("article");
    cards.forEach((card) => {
      if (card.textContent?.includes("get_incident_context") ||
          card.textContent?.includes("list_recent_deploys") ||
          card.textContent?.includes("get_policy_state")) {
        expect(card).toHaveTextContent("Available");
      }
    });
  });

  it("shows availability: propose_rollback Available in incident, No action required in healthy", async () => {
    setupRegistered();
    policyPilotRuntime.selectScenario("incident");
    render(<WebMCPStatus />);

    await waitFor(() => {
      expect(screen.getByText(/5 tools registered/i)).toBeInTheDocument();
    });

    const proposeCard = screen.getByText("propose_rollback").closest("article");
    expect(proposeCard).toHaveTextContent("Available");

    policyPilotRuntime.selectScenario("healthy");
    await waitFor(() => {
      expect(screen.getByText("No action required")).toBeInTheDocument();
    });
  });

  it("shows availability: execute_approved_rollback Blocked/Available/Completed in incident, always Blocked in healthy", async () => {
    setupRegistered();
    policyPilotRuntime.selectScenario("incident");
    render(<WebMCPStatus />);

    await waitFor(() => {
      expect(screen.getByText(/5 tools registered/i)).toBeInTheDocument();
    });

    let executeCard = screen.getByText("execute_approved_rollback").closest("article");
    expect(executeCard).toHaveTextContent("Blocked");

    policyPilotRuntime.proposeRollback({ deploymentId: "DEP-8821" });
    policyPilotRuntime.approveCurrentProposal();

    await waitFor(() => {
      executeCard = screen.getByText("execute_approved_rollback").closest("article");
      expect(executeCard).toHaveTextContent("Available");
    });

    const approval = prepareApprovedRollback(policyPilotRuntime);
    policyPilotRuntime.executeApprovedRollback(approval);

    await waitFor(() => {
      executeCard = screen.getByText("execute_approved_rollback").closest("article");
      expect(executeCard).toHaveTextContent("Completed");
    });

    policyPilotRuntime.selectScenario("healthy");
    await waitFor(() => {
      executeCard = screen.getByText("execute_approved_rollback").closest("article");
      expect(executeCard).toHaveTextContent("Blocked");
    });
  });

  it("shows full policy explanation in title attribute on availability", async () => {
    setupRegistered();
    policyPilotRuntime.selectScenario("incident");
    render(<WebMCPStatus />);

    await waitFor(() => {
      expect(screen.getByText(/5 tools registered/i)).toBeInTheDocument();
    });

    const policyCard = screen.getByText("get_policy_state").closest("article");
    const availabilityElement = policyCard?.querySelector('[title]');
    expect(availabilityElement).toBeInTheDocument();
    expect(availabilityElement).toHaveAttribute("title", "Inspection and drafting allowed; execution requires human approval.");
  });
});

describe("Day 4: Page title and selector integration", () => {
  it("shows PolicyPilot / Day 4 title", () => {
    render(<Home />);
    expect(screen.getByText(/PolicyPilot \/ Day 4/i)).toBeInTheDocument();
  });

  it("renders ScenarioSelector in the intro section", () => {
    render(<Home />);
    expect(screen.getByText("Collaboration scenario")).toBeInTheDocument();
    expect(screen.getByLabelText("Active incident")).toBeInTheDocument();
    expect(screen.getByLabelText("Healthy system")).toBeInTheDocument();
  });

  it("ScenarioSelector calls selectScenario on change", () => {
    const selectSpy = vi.spyOn(policyPilotRuntime, "selectScenario");
    render(<Home />);
    fireEvent.click(screen.getByLabelText("Healthy system"));
    expect(selectSpy).toHaveBeenCalledWith("healthy");
  });
});