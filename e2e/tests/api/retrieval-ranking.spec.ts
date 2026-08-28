import { expect, test } from '@playwright/test';
import { rankKnowledgeHits } from '../../../apps/web/lib/chat/retrieval-ranking';

test('promotes an exact diagram/schema hit over broadly similar dense results', () => {
  const ranked = rankKnowledgeHits('list every view and routine under Resources', [
    {
      title: 'Wikipedia:Contents',
      text: 'Reference works and pages with general information about views.',
    },
    {
      title: 'Movie Database ER Diagram',
      text: 'Views: film_list, actor_info. Resources contains routines: get_customer and film_in_stock.',
    },
  ]);

  expect(ranked[0]?.title).toBe('Movie Database ER Diagram');
});

test('keeps dense order when the query has no distinctive searchable terms', () => {
  const hits = [{ title: 'First', text: 'alpha' }, { title: 'Second', text: 'beta' }];
  expect(rankKnowledgeHits('the and', hits)).toEqual(hits);
});
