import { describe, expect, it } from 'vitest';
import {
  hasCompletedLongAnalysisStep,
  hasCompletedTabularVisualizationStep,
  isLikelyTabularQuestion,
  latestAnalysisAttemptFailed,
  requestedLongAnalysisItemCount,
  requiresTabularSandbox,
  supportsStableTabularPlanner,
  tabularToolPlannerModel,
  tabularToolsForStep,
} from './tabular-routing';

describe('isLikelyTabularQuestion', () => {
  it('routes a question that names one distinctive workbook metric', () => {
    expect(
      isLikelyTabularQuestion({
        text: "What is the dropout level among master's students in Germany?",
        datasetNames: ['germany_integration_university_dataset_clean.xlsx'],
        columnNames: ['Student cohort', 'Master dropout rate', 'University'],
      }),
    ).toBe(true);
  });

  it('does not route an ordinary question solely because a generic column exists', () => {
    expect(
      isLikelyTabularQuestion({
        text: 'Who is presenting in the evacuation video?',
        datasetNames: ['metrics.xlsx'],
        columnNames: ['Name', 'Date', 'Status'],
      }),
    ).toBe(false);
  });

  it('does not mistake a requested table format for a tabular source', () => {
    expect(
      isLikelyTabularQuestion({
        text: 'Create a table with each named team member and a clothing description from the video.',
        datasetNames: ['Superstore.xlsx'],
        columnNames: ['Order ID', 'Product Name', 'Sales'],
      }),
    ).toBe(false);
  });

  it('keeps explicit data-table requests on the structured table path', () => {
    expect(
      isLikelyTabularQuestion({
        text: 'Show the data table columns and rows for Superstore.',
        datasetNames: ['Superstore.xlsx'],
        columnNames: ['Order ID', 'Product Name', 'Sales'],
      }),
    ).toBe(true);
  });
});

describe('tabularToolsForStep', () => {
  it('uses one capable artifact planner independent of the selected small chat model', () => {
    expect(tabularToolPlannerModel(true)).toBe('openai/gpt-4.1-mini');
    expect(tabularToolPlannerModel(false)).toBe('openai/gpt-4o-mini');
    expect(supportsStableTabularPlanner('openai')).toBe(true);
    expect(supportsStableTabularPlanner('vercel_ai_gateway')).toBe(true);
    expect(supportsStableTabularPlanner('anthropic')).toBe(false);
  });

  it('resolves every target from the prompt or the selected dataset size', () => {
    expect(
      requestedLongAnalysisItemCount(
        'You have a data document listing 102 participants. For each person, make 3 matches.',
      ),
    ).toBe(102);
    expect(requestedLongAnalysisItemCount('For every participant, make 3 matches.', 102)).toBe(102);
  });
  it('requires the exact table query before an answer is generated', () => {
    expect(tabularToolsForStep({ stepNumber: 0, toolNames: ['queryTabularData'] })).toEqual({
      toolChoice: { type: 'tool', toolName: 'queryTabularData' },
      activeTools: ['queryTabularData'],
    });
  });

  it('requires the sandbox for a cross-sheet join', () => {
    expect(
      tabularToolsForStep({
        stepNumber: 0,
        toolNames: ['queryTabularData', 'executeAnalysis'],
        requiresSandbox: requiresTabularSandbox('Join the Orders and Returns sheets with Python.'),
      }),
    ).toEqual({
      toolChoice: { type: 'tool', toolName: 'executeAnalysis' },
      activeTools: ['executeAnalysis'],
    });
  });

  it('does not require code for an ordinary grouped tabular question', () => {
    expect(requiresTabularSandbox('Show total sales by region.')).toBe(false);
  });

  it('answers after the first table result instead of requesting a second chart tool', () => {
    expect(
      tabularToolsForStep({
        stepNumber: 1,
        toolNames: ['queryTabularData', 'generateVisualization', 'executeAnalysis'],
      }),
    ).toEqual({ toolChoice: 'none', activeTools: [] });
  });
});

describe('latestAnalysisAttemptFailed', () => {
  it('recognizes a failed sandbox result so the route can repair it', () => {
    expect(
      latestAnalysisAttemptFailed([
        {
          content: [
            {
              type: 'tool-result',
              toolName: 'executeAnalysis',
              output: {
                type: 'json',
                value: { exitCode: 1, stderr: 'Completeness validation failed' },
              },
            },
          ],
        },
      ]),
    ).toBe(true);
  });

  it('does not retry a successful latest analysis', () => {
    expect(
      latestAnalysisAttemptFailed([
        {
          content: [{ type: 'tool-result', toolName: 'executeAnalysis', output: { exitCode: 0 } }],
        },
      ]),
    ).toBe(false);
  });
});

describe('hasCompletedTabularVisualizationStep', () => {
  it('stops after the structured query returns a host-renderable chart', () => {
    expect(
      hasCompletedTabularVisualizationStep([
        {
          toolResults: [
            {
              toolName: 'queryTabularData',
              output: {
                rows: [{ region: 'North', total: 10 }],
                visualization: { chartType: 'bar' },
              },
            },
          ],
        },
      ]),
    ).toBe(true);
    expect(
      hasCompletedTabularVisualizationStep([
        { toolResults: [{ toolName: 'queryTabularData', output: { rows: [] } }] },
      ]),
    ).toBe(false);
  });
});

describe('hasCompletedLongAnalysisStep', () => {
  it('stops only after a successful complete analysis artifact', () => {
    expect(
      hasCompletedLongAnalysisStep([
        {
          toolResults: [
            {
              toolName: 'executeAnalysis',
              output: {
                exitCode: 0,
                presentation: { kind: 'table', complete: true },
              },
            },
          ],
        },
      ]),
    ).toBe(true);
    expect(
      hasCompletedLongAnalysisStep([
        {
          toolResults: [
            {
              toolName: 'executeAnalysis',
              output: { exitCode: 1 },
            },
          ],
        },
      ]),
    ).toBe(false);
  });
});
