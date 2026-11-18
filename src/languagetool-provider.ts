// SPDX-License-Identifier: GPL-3.0-or-later
import type {ProofreadingConnection, ProofreadingIssue} from './proofreading-provider';
import {
  ProofreadingError, cancelledProofreading, invalidProofreadingResponse,
  isProofreadingObject, proofreadingServiceError, readProofreadingResponse,
  resolveProofreadingServiceURL,
} from './proofreading-service';

const MAX_TEXT = 12_000;
const MAX_ISSUES = 80;
const TIMEOUT_MS = 45_000;
const ATOM = '\uFFFC';
const DEFAULT_ENDPOINT = 'http://127.0.0.1:8081';
const UNSAFE_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Accept the server root, a reverse-proxy base, /v2, or the complete /v2/check. */
export function resolveLanguageToolEndpoint(value: string): string {
  const url = resolveProofreadingServiceURL(value);
  const base = url.pathname.replace(/\/+$/, '');
  url.pathname = /\/v2\/check$/.test(base) ? base : /\/v2$/.test(base) ? base + '/check' : base + '/v2/check';
  return url.href;
}

function boundariesOf(text: string): Set<number> {
  const boundaries = new Set<number>([0, text.length]);
  if (typeof Intl.Segmenter === 'function') {
    for (const part of new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text)) boundaries.add(part.index);
  } else {
    let offset = 0;
    for (const character of text) { boundaries.add(offset); offset += character.length; }
  }
  return boundaries;
}

function validUnicode(value: string): boolean {
  // An isolated UTF-16 surrogate is not a replacement character the editor
  // can faithfully display or save. A normal surrogate pair is preserved.
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}

/** Give an insertion a nonempty selection without changing its actual edit. */
function insertionAnchor(text: string, at: number, boundaries: Set<number>): {start: number; end: number} | undefined {
  // Search only the same formula/reference-free segment. A token plus any
  // intervening whitespace lets punctuation at a line/word edge be inserted
  // at the exact reported position rather than moved to a neighbouring word.
  const segmentStart = at === 0 ? 0 : text.lastIndexOf(ATOM, at - 1) + 1;
  const nextAtom = text.indexOf(ATOM, at);
  const segmentEnd = nextAtom === -1 ? text.length : nextAtom;
  const segment = text.slice(segmentStart, segmentEnd);
  let best: {start: number; end: number; distance: number} | undefined;
  for (const token of segment.matchAll(/\S+/gu)) {
    const start = segmentStart + token.index;
    const end = start + token[0].length;
    const distance = at < start ? start - at : at > end ? at - end : 0;
    const anchorStart = Math.min(start, at), anchorEnd = Math.max(end, at);
    if (distance > 80 || anchorEnd - anchorStart > 500 || !boundaries.has(anchorStart) || !boundaries.has(anchorEnd)) continue;
    if (!best || distance < best.distance) best = {start: anchorStart, end: anchorEnd, distance};
  }
  if (best) return {start: best.start, end: best.end};
  // A whitespace-only segment has no visible token. It still has a real
  // editable character to anchor to; never select an adjacent protected atom.
  const edges = [...boundaries].filter(offset => offset >= segmentStart && offset <= segmentEnd);
  const before = [...edges].reverse().find(offset => offset < at);
  const after = edges.find(offset => offset > at);
  if (before !== undefined && at - before <= 500) return {start: before, end: at};
  if (after !== undefined && after - at <= 500) return {start: at, end: after};
  return undefined;
}

/** Sentence boundaries are dependencies, never replacement ranges. */
function sentenceSpans(text: string, language: string): {start: number; end: number}[] {
  if (typeof Intl.Segmenter === 'function') {
    try {
      return [...new Intl.Segmenter(language === 'auto' ? undefined : language, {granularity: 'sentence'}).segment(text)]
        .map(part => ({start: part.index, end: part.index + part.segment.length}));
    } catch { /* A compatible server may accept a locale unknown to this runtime. */ }
  }
  const spans: {start: number; end: number}[] = [];
  let start = 0;
  for (const terminal of text.matchAll(/[.!?。！？]+["'”’»）)\]]*\s*/gu)) {
    const at = terminal.index, end = at + terminal[0].length;
    // Be conservative around decimal points and common English abbreviations.
    if (terminal[0] === '.' && /\d/.test(text[at - 1] ?? '') && /\d/.test(text[end] ?? '')) continue;
    if (terminal[0].startsWith('.') && /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Za-z])$/i.test(text.slice(start, at))) continue;
    spans.push({start, end}); start = end;
  }
  if (start < text.length) spans.push({start, end: text.length});
  return spans;
}

function grammarContext(text: string, start: number, end: number, sentences: {start: number; end: number}[]) {
  const first = sentences.find(sentence => sentence.end > start);
  const last = sentences.find(sentence => sentence.end >= end);
  const contextStart = first?.start ?? 0, contextEnd = last?.end ?? text.length;
  return {start: contextStart, end: contextEnd, original: text.slice(contextStart, contextEnd)};
}

function parseMatches(text: string, body: string, language: string): ProofreadingIssue[] {
  let response: unknown;
  try { response = JSON.parse(body); } catch { throw invalidProofreadingResponse(); }
  if (!isProofreadingObject(response) || !Array.isArray(response.matches)) {
    throw invalidProofreadingResponse();
  }
  const boundaries = boundariesOf(text);
  let sentences: {start: number; end: number}[] | undefined;
  const candidates: ProofreadingIssue[] = [];
  const duplicates = new Set<string>();
  for (const match of response.matches) {
    if (!isProofreadingObject(match)) continue;
    const {offset, length, message, replacements, rule} = match;
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 ||
      typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > 500 || offset + length > text.length ||
      !boundaries.has(offset) || !boundaries.has(offset + length) ||
      typeof message !== 'string' || !message.trim() || message.length > 600 ||
      !Array.isArray(replacements) || !isProofreadingObject(rule) || typeof rule.issueType !== 'string') continue;
    const anchor = length ? {start: offset, end: offset + length} : insertionAnchor(text, offset, boundaries);
    if (!anchor) continue;
    const {start, end} = anchor;
    const original = text.slice(start, end);
    if (!original || original.includes(ATOM) || !validUnicode(original) || UNSAFE_TEXT.test(original)) continue;
    const alternatives: string[] = [];
    for (const candidate of replacements) {
      if (!isProofreadingObject(candidate) || typeof candidate.value !== 'string') continue;
      const value = candidate.value;
      if (value.includes(ATOM) || !validUnicode(value) || UNSAFE_TEXT.test(value) ||
        value.length > Math.min(500, Math.max(80, length * 3))) continue;
      const replacement = length ? value : text.slice(start, offset) + value + text.slice(offset, end);
      if (replacement === original || replacement.length > 500 || alternatives.includes(replacement)) continue;
      alternatives.push(replacement);
      if (alternatives.length === 5) break;
    }
    // LanguageTool explicitly permits diagnostics with no suggested rewrite.
    // Invalid supplied alternatives must not become applicable edits, either.
    const issue: ProofreadingIssue = {
      start, end, original, replacements: alternatives, message: message.trim(),
      kind: rule.issueType === 'misspelling' ? 'spelling' : 'grammar',
    };
    if (issue.kind === 'grammar') {
      sentences ??= sentenceSpans(text, language);
      issue.context = grammarContext(text, start, end, sentences);
    }
    const key = JSON.stringify([start, end, issue.replacements, issue.kind, issue.message, rule.id]);
    if (!duplicates.has(key)) { duplicates.add(key); candidates.push(issue); }
    if (candidates.length === MAX_ISSUES) break;
  }
  // Unlike model-proposed spans, these are exact diagnostics from independent
  // rules. Overlapping rules remain useful; applying one invalidates only the
  // now-affected suggestions in the controller.
  return candidates.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Manually requested LanguageTool diagnostics; this function never edits text. */
export async function checkLanguageTool(
  text: string,
  connection: ProofreadingConnection,
  signal: AbortSignal,
  _uiLanguage: 'en' | 'zh-CN' = 'en',
): Promise<ProofreadingIssue[]> {
  if (signal.aborted) throw cancelledProofreading();
  if (typeof text !== 'string' || text.length > MAX_TEXT) throw new ProofreadingError('The text is too long to proofread in one request.');
  if (!text.trim()) return [];
  const endpoint = resolveLanguageToolEndpoint(connection.languageToolEndpoint || DEFAULT_ENDPOINT);
  const configuredLanguage = connection.languageToolLanguage;
  if (configuredLanguage !== undefined && typeof configuredLanguage !== 'string') {
    throw new ProofreadingError('Enter a valid LanguageTool language code.');
  }
  const language = configuredLanguage?.trim() || 'auto';
  if (language.length > 35 || (language !== 'auto' && !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language))) {
    throw new ProofreadingError('Enter a valid LanguageTool language code.');
  }
  // The UI language is unrelated to the document's language or mother tongue.
  // In auto mode LanguageTool needs an explicit English spelling variant.
  const form = new URLSearchParams({text, language});
  if (language === 'auto') form.set('preferredVariants', 'en-US');
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, {once: true});
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  let rejectAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(cancelledProofreading());
    controller.signal.addEventListener('abort', rejectAbort, {once: true});
  });
  try {
    if (signal.aborted) abort();
    const request = async () => {
      const response = await fetch(endpoint, {
        method: 'POST', signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'}, body: form.toString(),
      });
      if (!response.ok) throw await proofreadingServiceError(response, controller.signal, '', text);
      return parseMatches(text, await readProofreadingResponse(response, controller.signal), language);
    };
    return await Promise.race([request(), aborted]);
  } catch (error) {
    if (signal.aborted) throw cancelledProofreading();
    if (timedOut) throw new ProofreadingError('The proofreading request timed out.');
    if (error instanceof ProofreadingError) throw error;
    throw new ProofreadingError('Could not connect to the proofreading service.');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
    controller.abort();
  }
}
