import { describe, expect, it } from 'vitest';
import { isLikelyTabularQuestion, tabularToolsForStep } from './tabular-routing';

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
});

describe('tabularToolsForStep', () => {
  it('requires the exact table query before an answer is generated', () => {
    expect(tabularToolsForStep({ stepNumber: 0, toolNames: ['queryTabularData'] })).toEqual({
      toolChoice: { type: 'tool', toolName: 'queryTabularData' },
      activeTools: ['queryTabularData'],
    });
  });
});
