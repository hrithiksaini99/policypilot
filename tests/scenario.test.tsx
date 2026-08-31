import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ScenarioSelector from "@/components/scenario-selector";
import { policyPilotRuntime } from "@/lib/operations";

afterEach(cleanup);

describe("ScenarioSelector", () => {
  afterEach(() => {
    policyPilotRuntime.selectScenario("incident");
    policyPilotRuntime.reset();
    vi.restoreAllMocks();
  });

  it("renders a fieldset with legend 'Collaboration scenario'", () => {
    render(<ScenarioSelector />);
    expect(screen.getByRole("group", { name: "Collaboration scenario" })).toBeInTheDocument();
  });

  it("renders two radio options with correct labels", () => {
    render(<ScenarioSelector />);
    expect(screen.getByLabelText("Active incident")).toBeInTheDocument();
    expect(screen.getByLabelText("Healthy system")).toBeInTheDocument();
  });

  it("has 'Active incident' checked by default", () => {
    render(<ScenarioSelector />);
    expect(screen.getByLabelText("Active incident")).toBeChecked();
  });

  it("switches to 'Healthy system' on click and updates runtime", () => {
    render(<ScenarioSelector />);
    fireEvent.click(screen.getByLabelText("Healthy system"));
    expect(screen.getByLabelText("Healthy system")).toBeChecked();
    expect(policyPilotRuntime.getSnapshot().scenarioId).toBe("healthy");
  });

  it("announces scenario change via aria-live region", () => {
    render(<ScenarioSelector />);
    const liveRegion = screen.getByRole("status", { name: /active scenario/i });
    fireEvent.click(screen.getByLabelText("Healthy system"));
    expect(liveRegion).toHaveTextContent("Healthy system");
  });

  it("calls runtime.selectScenario on change", () => {
    const selectSpy = vi.spyOn(policyPilotRuntime, "selectScenario");
    render(<ScenarioSelector />);
    fireEvent.click(screen.getByLabelText("Healthy system"));
    expect(selectSpy).toHaveBeenCalledWith("healthy");
    selectSpy.mockRestore();
  });

  it("exposes native radio semantics and checked state", () => {
    render(<ScenarioSelector />);
    const incidentRadio = screen.getByLabelText("Active incident");
    const healthyRadio = screen.getByLabelText("Healthy system");
    expect(incidentRadio).toHaveAttribute("type", "radio");
    expect(incidentRadio).toBeChecked();
    fireEvent.click(healthyRadio);
    expect(healthyRadio).toBeChecked();
  });

  it("has focus-visible styles on radio inputs", () => {
    render(<ScenarioSelector />);
    const incidentRadio = screen.getByLabelText("Active incident");
    expect(incidentRadio).toHaveClass("focus-visible:outline-none");
    expect(incidentRadio).toHaveClass("focus-visible:ring-2");
    expect(incidentRadio).toHaveClass("focus-visible:ring-cyan-400");
  });
});