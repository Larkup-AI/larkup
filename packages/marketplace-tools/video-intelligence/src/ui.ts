export const VIDEO_INDEXING_BRIEF_SURFACE = {
  id: 'video-indexing-brief',
  version: 1,
  slot: 'data-indexing',
  title: 'Let your AI understand this video',
  description: 'Choose how deeply to analyze it and optionally point it to what matters most.',
  appliesTo: ['video'],
  estimate: {
    modeField: 'indexingMode',
    variants: [
      {
        value: 'fast',
        analyzedFramesPerSourceMinute: 5,
        ocrFramesPerSourceMinute: 3,
        processingSecondsPerSourceMinute: 4,
        maxProcessingSecondsPerSourceMinute: 5,
        fixedOverheadSeconds: 60,
        maxFixedOverheadSeconds: 60,
        creditsPerSourceMinute: 1,
      },
      {
        value: 'balanced',
        analyzedFramesPerSourceMinute: 12,
        ocrFramesPerSourceMinute: 8,
        processingSecondsPerSourceMinute: 16,
        maxProcessingSecondsPerSourceMinute: 30,
        fixedOverheadSeconds: 120,
        maxFixedOverheadSeconds: 240,
        creditsPerSourceMinute: 2,
      },
      {
        value: 'thorough',
        analyzedFramesPerSourceMinute: 30,
        ocrFramesPerSourceMinute: 20,
        processingSecondsPerSourceMinute: 32,
        maxProcessingSecondsPerSourceMinute: 60,
        fixedOverheadSeconds: 180,
        maxFixedOverheadSeconds: 360,
        creditsPerSourceMinute: 4,
      },
    ],
  },
  form: {
    submitLabel: 'Start indexing',
    fields: [
      {
        key: 'goal',
        type: 'textarea',
        label: 'What should your AI look for? (optional)',
        placeholder:
          'For example: find the final score, the moment the package is dropped, or every mention of pricing.',
      },
      {
        key: 'indexingMode',
        type: 'select',
        label: 'Coverage',
        defaultValue: 'balanced',
        options: [
          {
            label: 'Fast',
            value: 'fast',
            description: 'Sample key frames for a quick overview.',
            setValues: { processingAuthorityConfirmed: false },
          },
          {
            label: 'Balanced',
            value: 'balanced',
            description: 'Sample visual and OCR evidence across the video.',
            setValues: { processingAuthorityConfirmed: false },
          },
          {
            label: 'Thorough',
            value: 'thorough',
            description:
              'Let the agent inspect denser evidence around subtle or infrequent details.',
            setValues: { processingAuthorityConfirmed: false },
          },
        ],
      },
    ],
  },
} as const;

export const VIDEO_JOB_RESULT_SURFACE = {
  id: 'video-evidence-result',
  version: 1,
  slot: 'chat-result',
  title: 'Video evidence',
  resultType: 'application/vnd.larkup.video-evidence+json;version=1',
} as const;
