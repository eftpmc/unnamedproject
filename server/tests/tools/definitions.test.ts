import { describe, it, expect } from 'vitest';
import { toolDefinitions } from '../../src/tools/definitions.js';

describe('toolDefinitions', () => {
  it('does not include mcp_call', () => {
    expect(toolDefinitions.map(t => t.name)).not.toContain('mcp_call');
  });

  it('includes tool_search with a query input', () => {
    const toolSearch = toolDefinitions.find(t => t.name === 'tool_search');
    expect(toolSearch).toBeDefined();
    expect(toolSearch?.input_schema.required).toContain('query');
  });
});
