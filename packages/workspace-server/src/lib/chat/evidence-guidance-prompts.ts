// Model-facing guidance injected around retrieved evidence and before the
// final answer. Lifted verbatim from the chat route (behavior-preserving).
// Edit only through the benchmark regression gate.

/** Returned as evidence context when no source evidence is accessible this turn. */
export const NO_SOURCE_EVIDENCE_NOTICE =
  '\n\nNO CURRENTLY ACCESSIBLE SOURCE EVIDENCE WAS FOUND FOR THIS TURN. Source access can change after a previous answer, so do not repeat or infer facts from prior assistant messages. Explain briefly that the current knowledge base does not contain an answer.';

/** Returned when a media source was located but no answer-level evidence exists yet. */
export function mediaSourceLocatedNotice(mediaAssetId: string): string {
  return `\n\nA relevant media source was located (${mediaAssetId}), but no answer-level evidence has been returned yet. Use the installed evidence-query action for that media asset before answering. Do not say that the source has no answer and do not infer an outcome from this locator alone.`;
}

/** Appended when the model must produce a final answer with no further tool calls. */
export const FINAL_ANSWER_COMPLETENESS_NUDGE =
  'Check every part of the original question. Include the PDF figure or table value and sample size, the structured-data value, and the explicit difference or numerator/denominator calculation when requested. Keep source labels attached to their values. Use only verified calculation inputs from tool output for denominators; if none were printed, omit detailed arithmetic instead of inventing a population size. Check that every formula agrees with the reported result.';
