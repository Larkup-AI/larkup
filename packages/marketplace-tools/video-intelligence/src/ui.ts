export const VIDEO_INDEXING_BRIEF_SURFACE = {
  id: 'video-indexing-brief',
  version: 1,
  slot: 'data-indexing',
  title: 'Guide video indexing',
  appliesTo: ['video'],
  fields: [
    { key: 'goal', type: 'textarea', label: 'What should Larkup focus on?', required: false },
    {
      key: 'contentType',
      type: 'select',
      label: 'Video type',
      defaultValue: 'general',
      options: ['general', 'course', 'sports', 'surveillance', 'meeting'],
    },
    { key: 'knownEntities', type: 'tags', label: 'Known teams, objects, or topics' },
    { key: 'expectedQuestions', type: 'list', label: 'Questions you expect to ask' },
    {
      key: 'indexingMode',
      type: 'segmented',
      label: 'Indexing depth',
      defaultValue: 'balanced',
      options: ['fast', 'balanced', 'deep', 'full-coverage'],
    },
    {
      key: 'processingAuthorityConfirmed',
      type: 'checkbox',
      label: 'I confirm I am authorized to process this video for the stated purpose.',
      requiredWhen: { indexingMode: 'full-coverage' },
    },
  ],
} as const;

export const VIDEO_JOB_RESULT_SURFACE = {
  id: 'video-evidence-result',
  version: 1,
  slot: 'chat-result',
  title: 'Video evidence',
  resultType: 'application/vnd.larkup.video-evidence+json;version=1',
} as const;
