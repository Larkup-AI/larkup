import { describe, expect, it } from 'vitest';
import { getChatToolBehavior } from './tools';

describe('chat tool progress behavior', () => {
  it('keeps fast spreadsheet queries indeterminate', () => {
    expect(getChatToolBehavior('queryTabularData').showProgressBar).toBe(false);
  });

  it('keeps measurable long-running tool progress enabled by default', () => {
    expect(getChatToolBehavior('queryVideoKnowledge').showProgressBar).not.toBe(false);
  });

  it('renders structured media inventories with the generic data table', () => {
    expect(getChatToolBehavior('queryVideoEvidence')).toMatchObject({
      resultView: 'data-table',
      compactResult: false,
    });
  });

  it('renders answer exports as downloadable files without a fake text link', () => {
    expect(getChatToolBehavior('createDataExport')).toMatchObject({
      resultView: 'file-export',
      showProgressBar: false,
    });
  });
});
