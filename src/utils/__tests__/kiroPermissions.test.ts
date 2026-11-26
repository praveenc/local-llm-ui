import { describe, expect, it } from 'vitest';

import {
  approvalOutcome,
  approvalWords,
  endApproval,
  openApproval,
  openQuestion,
  parseKiroPermissionAnswer,
  parseKiroPermissionQuestion,
  parseKiroPermissionResult,
  questionLine,
  questionParts,
  readStoredApprovals,
  toStoredApproval,
} from '../kiroPermissions.ts';
import type { KiroPermissionQuestion } from '../kiroPermissions.ts';

const REQUEST_ID = '0b8e6f0a-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

const shell: KiroPermissionQuestion = {
  requestId: REQUEST_ID,
  toolCallId: 'run_command_1',
  title: 'echo hi > hello.txt',
  command: 'echo hi > hello.txt',
  options: [
    { optionId: 'accept', name: 'Allow', kind: 'allow_once' },
    { optionId: 'always-accept', name: 'Always allow', kind: 'allow_always' },
    { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
    { optionId: 'always-reject', name: 'Always deny', kind: 'reject_always' },
  ],
};

describe('parseKiroPermissionAnswer', () => {
  it('accepts a UUID request id and an option id', () => {
    expect(parseKiroPermissionAnswer({ requestId: REQUEST_ID, optionId: 'accept' })).toEqual({
      ok: true,
      value: { requestId: REQUEST_ID, optionId: 'accept' },
    });
  });

  it.each([
    [null],
    [[]],
    ['text'],
    [{ requestId: 'not-a-uuid', optionId: 'accept' }],
    [{ requestId: REQUEST_ID.toUpperCase(), optionId: 'accept' }],
    [{ requestId: REQUEST_ID }],
    [{ requestId: REQUEST_ID, optionId: '' }],
    [{ requestId: REQUEST_ID, optionId: 7 }],
    [{ requestId: REQUEST_ID, optionId: 'x'.repeat(201) }],
  ])('rejects %j', (body) => {
    expect(parseKiroPermissionAnswer(body).ok).toBe(false);
  });
});

describe('parseKiroPermissionQuestion', () => {
  it('keeps Kiro’s options in Kiro’s order', () => {
    expect(parseKiroPermissionQuestion(shell)).toEqual(shell);
  });

  it('keeps the review fields and drops bad related ids', () => {
    const parsed = parseKiroPermissionQuestion({
      requestId: REQUEST_ID,
      toolCallId: 'turn_approval_1',
      title: 'Review changes',
      review: true,
      relatedToolCallIds: ['toolu_write', 7, ''],
      options: [
        { optionId: 'accept', name: 'Accept changes', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject changes', kind: 'reject_once' },
      ],
    });
    expect(parsed?.review).toBe(true);
    expect(parsed?.relatedToolCallIds).toEqual(['toolu_write']);
  });

  it('drops options without an id or a kind, and a question without options', () => {
    const parsed = parseKiroPermissionQuestion({
      ...shell,
      options: [{ optionId: 'a', kind: 'allow_once' }, { name: 'no id' }, 'x'],
    });
    expect(parsed?.options).toEqual([{ optionId: 'a', name: 'a', kind: 'allow_once' }]);
    expect(parseKiroPermissionQuestion({ ...shell, options: [] })).toBeUndefined();
    expect(parseKiroPermissionQuestion({ ...shell, requestId: '' })).toBeUndefined();
    expect(parseKiroPermissionQuestion(null)).toBeUndefined();
  });

  it('cuts long texts', () => {
    const parsed = parseKiroPermissionQuestion({ ...shell, command: 'x'.repeat(5000) });
    expect(parsed?.command).toHaveLength(2000);
  });

  it('records that a command was cut, and only then', () => {
    expect(parseKiroPermissionQuestion({ ...shell, command: 'x'.repeat(2001) })?.commandCut).toBe(
      true
    );
    const exact = parseKiroPermissionQuestion({ ...shell, command: 'x'.repeat(2000) });
    expect(exact?.command).toHaveLength(2000);
    expect(exact).not.toHaveProperty('commandCut');
    expect(parseKiroPermissionQuestion(shell)).not.toHaveProperty('commandCut');
    expect(
      parseKiroPermissionQuestion({ ...shell, command: undefined, title: 'T'.repeat(5000) })
    ).not.toHaveProperty('commandCut');
  });

  it('keeps the cut mark on the open approval', () => {
    const question = parseKiroPermissionQuestion({ ...shell, command: 'x'.repeat(2500) })!;
    expect(openApproval(question)).toMatchObject({ commandCut: true });
    expect(openApproval({ ...shell, requestId: REQUEST_ID })).not.toHaveProperty('commandCut');
  });
});

describe('parseKiroPermissionResult', () => {
  it('reads the three outcomes', () => {
    for (const outcome of ['answered', 'cancelled', 'timeout']) {
      expect(parseKiroPermissionResult({ requestId: REQUEST_ID, outcome })?.outcome).toBe(outcome);
    }
    expect(
      parseKiroPermissionResult({
        requestId: REQUEST_ID,
        optionId: 'reject',
        kind: 'reject_once',
        outcome: 'answered',
      })
    ).toEqual({
      requestId: REQUEST_ID,
      optionId: 'reject',
      kind: 'reject_once',
      outcome: 'answered',
    });
  });

  it('rejects an unknown outcome or a missing id', () => {
    expect(parseKiroPermissionResult({ requestId: REQUEST_ID, outcome: 'maybe' })).toBeUndefined();
    expect(parseKiroPermissionResult({ outcome: 'answered' })).toBeUndefined();
  });
});

describe('approvals', () => {
  it('says the answer in words from the kind', () => {
    const open = openApproval(shell);
    expect(approvalWords(open)).toBe('Waiting for your answer');
    const words = (kind: string, outcome: 'answered' | 'cancelled' | 'timeout' = 'answered') =>
      approvalWords(endApproval(open, { requestId: REQUEST_ID, kind, outcome }));
    expect(words('allow_once')).toBe('Allowed');
    expect(words('allow_always')).toBe('Always allowed');
    expect(words('reject_once')).toBe('Denied');
    expect(words('reject_always')).toBe('Always denied');
    expect(words('something_new')).toBe('Answered');
    expect(words('reject_once', 'timeout')).toBe('Not answered');
    expect(words('reject_once', 'cancelled')).toBe('Not answered');
  });

  it('says "Changes accepted" and "Changes rejected" for a review', () => {
    const review = openApproval({ ...shell, review: true, command: undefined });
    const end = (kind: string) =>
      approvalWords(endApproval(review, { requestId: REQUEST_ID, kind, outcome: 'answered' }));
    expect(end('allow_once')).toBe('Changes accepted');
    expect(end('reject_once')).toBe('Changes rejected');
  });

  it('stores an open question as not answered, without its options', () => {
    const stored = toStoredApproval(openApproval(shell));
    expect(stored).toEqual({ requestId: REQUEST_ID, state: 'not-answered' });
    expect(approvalWords(stored)).toBe('Not answered');
  });

  it('stores an answer with its kind only', () => {
    const ended = endApproval(openApproval(shell), {
      requestId: REQUEST_ID,
      optionId: 'always-accept',
      kind: 'allow_always',
      outcome: 'answered',
    });
    expect(toStoredApproval(ended)).toEqual({
      requestId: REQUEST_ID,
      state: 'answered',
      kind: 'allow_always',
    });
  });

  it('reads stored approvals back and never as open', () => {
    expect(
      readStoredApprovals([
        { requestId: 'a', state: 'answered', kind: 'reject_once' },
        { requestId: 'b', state: 'open', kind: 'allow_once', options: [] },
        { requestId: 'c', state: 'answered', review: true, kind: 'allow_once' },
        { state: 'answered' },
        'x',
      ])
    ).toEqual([
      { requestId: 'a', state: 'answered', kind: 'reject_once' },
      { requestId: 'b', state: 'not-answered' },
      { requestId: 'c', state: 'answered', kind: 'allow_once', review: true },
    ]);
    expect(readStoredApprovals([])).toBeUndefined();
    expect(readStoredApprovals('x')).toBeUndefined();
  });

  it('gives the tool outcome from the last approval', () => {
    expect(approvalOutcome(undefined)).toBeUndefined();
    expect(approvalOutcome([{ state: 'answered', kind: 'reject_once' }])).toBe('denied');
    expect(approvalOutcome([{ state: 'answered', kind: 'reject_always' }])).toBe('denied');
    expect(approvalOutcome([{ state: 'answered', kind: 'allow_once' }])).toBeUndefined();
    expect(approvalOutcome([{ state: 'not-answered' }])).toBe('not-answered');
    expect(approvalOutcome([{ state: 'open' }])).toBeUndefined();
    // A write that was allowed, then its changes rejected
    expect(
      approvalOutcome([
        { state: 'answered', kind: 'allow_once' },
        { state: 'answered', kind: 'reject_once' },
      ])
    ).toBe('denied');
  });

  it('finds the open question', () => {
    const open = openApproval(shell);
    expect(openQuestion([open])).toBe(open);
    expect(openQuestion([toStoredApproval(open)])).toBeUndefined();
    expect(openQuestion(undefined)).toBeUndefined();
  });
});

describe('questionLine', () => {
  it('names the command, the review, or the tool and its resource, with no backticks', () => {
    expect(questionLine(openApproval(shell))).toBe('Kiro wants to run echo hi > hello.txt');
    expect(questionLine({ review: true, title: 'Review changes' })).toBe(
      'Kiro wants you to review the changes'
    );
    expect(questionLine({ title: 'Write File', resource: 'notes.txt' })).toBe(
      'Kiro wants to use Write File · notes.txt'
    );
    expect(questionLine({ title: 'Write File' })).toBe('Kiro wants to use Write File');
    expect(questionLine({ resource: 'notes.txt' })).toBe('Kiro wants to use notes.txt');
    expect(questionLine({})).toBe('Waiting for your answer');
    // Backticks inside a command are its own content; the question adds none
    expect(questionLine({ command: 'echo `date`' })).toBe('Kiro wants to run echo `date`');
    for (const approval of [
      { review: true },
      { title: 'Write File', resource: 'notes.txt' },
      { title: 'Write File' },
      { resource: 'notes.txt' },
      {},
    ]) {
      expect(questionLine(approval)).not.toContain('`');
    }
    expect(questionLine({ command: 'x'.repeat(10) })).toBe(`Kiro wants to run ${'x'.repeat(10)}`);
  });

  it('shortens a long command to one line of 80 characters', () => {
    expect(questionLine({ command: 'x'.repeat(200) })).toBe(`Kiro wants to run ${'x'.repeat(80)}…`);
    expect(questionLine({ command: 'echo a\n  echo b\n' })).toBe('Kiro wants to run echo a echo b');
  });

  it('cuts a very long title or resource', () => {
    const line = questionLine({ title: 'T'.repeat(500) });
    expect(line.length).toBeLessThanOrEqual(161);
    expect(line.endsWith('…')).toBe(true);
  });
});

describe('questionParts', () => {
  it('gives the whole command as code, without a cut', () => {
    const command = `echo ${'x'.repeat(300)}`;
    expect(questionParts({ command })).toEqual({ before: 'Kiro wants to run', code: command });
  });

  it('says when the command was cut', () => {
    expect(questionParts({ command: 'ls', commandCut: true })).toEqual({
      before: 'Kiro wants to run',
      code: 'ls',
      codeCut: true,
    });
    expect(questionParts({ command: 'ls' })).not.toHaveProperty('codeCut');
  });

  it('drops the trailing line breaks of a command for display only', () => {
    const approval = { command: 'echo hi\n\n' };
    expect(questionParts(approval).code).toBe('echo hi');
    expect(approval.command).toBe('echo hi\n\n');
    expect(questionLine(approval)).toBe('Kiro wants to run echo hi');
  });

  it('keeps the line breaks of a command', () => {
    const command = 'for f in a b; do\n  echo "$f"\ndone';
    expect(questionParts({ command }).code).toBe(command);
  });

  it('has no code for the other kinds', () => {
    expect(questionParts({ review: true, command: 'ls' })).toEqual({
      before: 'Kiro wants you to review the changes',
    });
    expect(questionParts({ title: 'Write File', resource: 'notes.txt' })).toEqual({
      before: 'Kiro wants to use Write File · notes.txt',
    });
    expect(questionParts({ title: 'Write File' })).toEqual({
      before: 'Kiro wants to use Write File',
    });
    expect(questionParts({ resource: 'notes.txt' })).toEqual({
      before: 'Kiro wants to use notes.txt',
    });
    expect(questionParts({})).toEqual({ before: 'Waiting for your answer' });
  });
});
