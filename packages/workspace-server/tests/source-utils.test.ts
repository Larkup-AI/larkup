import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectYouTubePlayerMetadata,
  inspectYouTubeWatchPage,
  inspectYouTubeWatchUrl,
} from '../src/lib/media/source-utils';

const url = 'https://www.youtube.com/watch?v=6HaHNYjnghE';

test('reads a selected YouTube duration from public watch-page metadata', () => {
  const html = String.raw`<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"6HaHNYjnghE","title":"Highlights | Spain vs Argentina","lengthSeconds":"117","shortDescription":"A brace } and an escaped quote \" stay inside this string."},"playabilityStatus":{"status":"OK"}};</script>`;

  assert.deepEqual(inspectYouTubeWatchPage(url, html), {
    originalUrl: url,
    title: 'Highlights | Spain vs Argentina',
    durationSecs: 117,
    singleItemDurationSecs: 117,
    singleItemUrl: url,
    entryCount: 1,
    mediaType: 'video',
    isYouTube: true,
  });
});

test('reads a selected YouTube duration from public player metadata', () => {
  assert.deepEqual(
    inspectYouTubePlayerMetadata(url, {
      videoDetails: {
        videoId: '6HaHNYjnghE',
        title: 'Highlights | Spain vs Argentina',
        lengthSeconds: '117',
      },
    }),
    {
      originalUrl: url,
      title: 'Highlights | Spain vs Argentina',
      durationSecs: 117,
      singleItemDurationSecs: 117,
      singleItemUrl: url,
      entryCount: 1,
      mediaType: 'video',
      isYouTube: true,
    },
  );
});

test('uses signed stream durations when a reduced player response omits video details', () => {
  assert.deepEqual(
    inspectYouTubePlayerMetadata(url, {
      streamingData: {
        formats: [{ approxDurationMs: '117075' }],
        adaptiveFormats: [{ approxDurationMs: '116783' }],
      },
    }),
    {
      originalUrl: url,
      durationSecs: 117,
      singleItemDurationSecs: 117,
      singleItemUrl: url,
      entryCount: 1,
      mediaType: 'video',
      isYouTube: true,
    },
  );
});

test('does not accept watch-page metadata for another video or without a duration', () => {
  assert.equal(
    inspectYouTubeWatchPage(
      url,
      '<script>{"videoDetails":{"videoId":"different","lengthSeconds":"117"}}</script>',
    ),
    undefined,
  );
  assert.equal(
    inspectYouTubeWatchPage(
      url,
      '<script>{"videoDetails":{"videoId":"6HaHNYjnghE","title":"Unavailable"}}</script>',
    ),
    undefined,
  );
});

test('keeps the duration-less watch URL fallback for temporary provider failures', () => {
  assert.deepEqual(inspectYouTubeWatchUrl(url), {
    originalUrl: url,
    singleItemUrl: url,
    entryCount: 1,
    mediaType: 'video',
    isYouTube: true,
  });
});
