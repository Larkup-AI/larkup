import { describe, expect, it } from 'vitest';
import {
  isLikelyTabularQuestion,
  requiresTabularSandbox,
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
});
