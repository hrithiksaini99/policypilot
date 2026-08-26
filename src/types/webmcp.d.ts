interface PolicyPilotToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute(input: Record<string, never>): Promise<unknown> | unknown;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
}

interface PolicyPilotModelContext {
  registerTool(tool: PolicyPilotToolDefinition): Promise<void>;
}

interface Document {
  readonly modelContext?: PolicyPilotModelContext;
}
