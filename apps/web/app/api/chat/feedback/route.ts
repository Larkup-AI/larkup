import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { readDocuments } from '@larkup/core/documents-store';
import { readGroups } from '@larkup/core/groups-store';
import { filterDocumentsAvailableToAssistant } from '@larkup/core/assistant-data-scope';
import {
  deleteGroundedAnswerCacheEntry,
  saveGroundedAnswerDislike,
  saveGroundedAnswerCacheEntry,
} from '@larkup/core/grounded-answer-cache';
import { runWithProject } from '@larkup/core/project-store';
import { assistantSourceScopeFingerprint } from '@/lib/chat/assistant-source-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    const feedback = body.feedback;
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
    const claimedFingerprint =
      typeof body.sourceScopeFingerprint === 'string' ? body.sourceScopeFingerprint : undefined;
    if (!question || question.length > 8_000) {
      return NextResponse.json(
        { error: 'A valid question is required.' },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const updateCache = async () => {
      if (feedback !== 'liked' && feedback !== 'disliked') {
        const removed = await deleteGroundedAnswerCacheEntry(question);
        return { cached: false, removed };
      }
      if (feedback === 'liked' && (!answer || answer.length > 100_000)) {
        throw new Error('A valid answer is required to cache feedback.');
      }
      const [documents, groups, config] = await Promise.all([
        readDocuments(),
        readGroups(),
        readConfig(),
      ]);
      const currentFingerprint = assistantSourceScopeFingerprint(
        filterDocumentsAvailableToAssistant(documents, groups),
        { configUpdatedAt: config.updatedAt },
      );
      if (feedback === 'liked' && claimedFingerprint && claimedFingerprint !== currentFingerprint) {
        return { cached: false, stale: true };
      }
      if (feedback === 'disliked') {
        const entry = await saveGroundedAnswerDislike({
          question,
          sourceScopeFingerprint: currentFingerprint,
        });
        return { cached: false, feedbackStored: true, entry };
      }
      const entry = await saveGroundedAnswerCacheEntry({
        question,
        answer,
        sourceScopeFingerprint: currentFingerprint,
      });
      return { cached: true, entry };
    };

    const result = projectId ? await runWithProject(projectId, updateCache) : await updateCache();
    if ('stale' in result) {
      return NextResponse.json(result, { status: 409, headers: noStoreHeaders });
    }
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[chat-feedback] failed to update grounded answer cache:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not save answer feedback.' },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
