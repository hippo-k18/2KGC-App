import { describe, expect, it } from 'vitest';

import {
  formatWatchDate,
  groupWatchable,
  playableUrl,
  recordingPanel,
  streamPanel,
  ticketSentence,
  watchRowTag,
  type RecordingFacts,
  type WatchCandidate,
  type StreamFacts,
} from './watch-core';

const MAY = { day: 'Tue 4 May', time: '2:30 PM' };

const STREAM: StreamFacts = {
  state: 'live',
  embeddable: true,
  embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
  watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  providerLabel: 'YouTube',
};

const RECORDING: RecordingFacts = {
  title: 'A Knowledge Graph for Clinical Trial Matching',
  embeddable: true,
  embedUrl: 'https://player.vimeo.com/video/76979871',
  watchUrl: 'https://vimeo.com/76979871',
  providerLabel: 'Vimeo',
  durationSeconds: 2730,
  availableUntilMs: Date.UTC(2027, 11, 31),
};

function stream(over: Partial<Parameters<typeof streamPanel>[0]> = {}) {
  return streamPanel({
    outcome: 'ready',
    stream: STREAM,
    stateHint: 'live',
    allowed: [],
    myTicketType: 'Startup Table',
    startsAt: MAY,
    hasRecording: false,
    ...over,
  });
}

function recording(over: Partial<Parameters<typeof recordingPanel>[0]> = {}) {
  return recordingPanel({
    outcome: 'ready',
    recording: RECORDING,
    exists: true,
    allowed: [],
    myTicketType: 'Startup Table',
    nowMs: Date.UTC(2027, 5, 1),
    ...over,
  });
}

describe('playableUrl', () => {
  it('passes a normalised https address', () => {
    expect(playableUrl('https://player.vimeo.com/video/1')).toBe(
      'https://player.vimeo.com/video/1',
    );
  });

  it('refuses everything that is not https', () => {
    // The two downstream uses are an iframe `src` and `Linking.openURL`, and
    // both of those take a `javascript:` string without complaint.
    expect(playableUrl('javascript:alert(1)')).toBeNull();
    expect(playableUrl('http://example.com/v')).toBeNull();
    expect(playableUrl('data:text/html,<script>')).toBeNull();
    expect(playableUrl('www.youtube.com/watch?v=x')).toBeNull();
  });

  it('refuses a missing or empty address rather than throwing', () => {
    expect(playableUrl(undefined)).toBeNull();
    expect(playableUrl(null)).toBeNull();
    expect(playableUrl('   ')).toBeNull();
  });
});

describe('formatWatchDate', () => {
  it('reads the instant in UTC, the way the dashboard asked for it', () => {
    expect(formatWatchDate(Date.UTC(2027, 11, 31, 23, 59))).toBe('31 December 2027');
  });

  it('is empty for anything that is not a date', () => {
    expect(formatWatchDate(null)).toBe('');
    expect(formatWatchDate(undefined)).toBe('');
    expect(formatWatchDate(Number.NaN)).toBe('');
  });
});

describe('ticketSentence', () => {
  it('names the tickets that do cover it, and the one the reader holds', () => {
    expect(ticketSentence('recording', ['All Access (VIP)', 'Gold'], 'Startup Table')).toBe(
      'This recording is included with All Access (VIP) and Gold tickets. Your ticket is Startup Table.',
    );
  });

  it('says only what it can stand behind when no names were stamped', () => {
    expect(ticketSentence('stream', [], null)).toBe(
      'Watching this session live is not included with every ticket.',
    );
  });
});

describe('streamPanel', () => {
  it('draws nothing at all when the session has no stream', () => {
    expect(stream({ outcome: 'none', stateHint: null, stream: null })).toBeNull();
  });

  it('plays a live stream in the provider embed', () => {
    const panel = stream();
    expect(panel?.title).toBe('Live now');
    expect(panel?.live).toBe(true);
    expect(panel?.embedUrl).toBe(STREAM.embedUrl);
  });

  it('sends a viewer out to a provider that refuses to be framed', () => {
    const panel = stream({
      stream: {
        ...STREAM,
        embeddable: false,
        embedUrl: 'https://kgc.zoom.us/j/123?pwd=abc',
        watchUrl: 'https://kgc.zoom.us/j/123?pwd=abc',
        providerLabel: 'Zoom',
      },
    });
    expect(panel?.embedUrl).toBeNull();
    expect(panel?.openUrl).toBe('https://kgc.zoom.us/j/123?pwd=abc');
    expect(panel?.openLabel).toBe('Join in Zoom');
    expect(panel?.message).toContain('running in Zoom');
  });

  it('says when a scheduled stream starts, and does not open a player early', () => {
    const panel = stream({ stateHint: 'scheduled', stream: { ...STREAM, state: 'scheduled' } });
    expect(panel?.title).toBe('Streaming later');
    expect(panel?.embedUrl).toBeNull();
    expect(panel?.message).toBe('This session streams here from Tue 4 May at 2:30 PM.');
  });

  it('points a finished stream at the recording when there is one', () => {
    const ended = { ...STREAM, state: 'ended' as const };
    expect(stream({ stateHint: 'ended', stream: ended, hasRecording: true })?.message).toBe(
      'The live stream has finished. The recording is below.',
    );
    expect(stream({ stateHint: 'ended', stream: ended, hasRecording: false })?.message).toBe(
      'The live stream has finished. No recording has been posted yet.',
    );
  });

  it('reads a refusal as a ticket answer and names the tickets that do cover it', () => {
    const panel = stream({
      outcome: 'denied',
      stream: null,
      allowed: ['All Access (VIP)'],
    });
    expect(panel?.barred).toBe(true);
    expect(panel?.embedUrl).toBeNull();
    expect(panel?.message).toBe(
      'Watching this session live is included with All Access (VIP) tickets. Your ticket is Startup Table.',
    );
  });

  it('survives a malformed link instead of framing it', () => {
    const panel = stream({
      stream: { ...STREAM, embedUrl: 'javascript:alert(1)', watchUrl: '' },
    });
    expect(panel?.embedUrl).toBeNull();
    expect(panel?.openUrl).toBeNull();
    expect(panel?.message).toContain('link to it is missing');
  });
});

describe('recordingPanel', () => {
  it('draws nothing when the session has no recording', () => {
    expect(recording({ outcome: 'none', exists: false, recording: null })).toBeNull();
  });

  it('shows the length and the closing date on an open recording', () => {
    const panel = recording();
    expect(panel?.embedUrl).toBe(RECORDING.embedUrl);
    expect(panel?.message).toBe('Runs 45:30. Available until 31 December 2027.');
  });

  it('gives the date a closed recording closed on, rather than an empty player', () => {
    const panel = recording({ nowMs: Date.UTC(2028, 0, 2) });
    expect(panel?.embedUrl).toBeNull();
    expect(panel?.message).toBe(
      'This recording closed on 31 December 2027 and is no longer available.',
    );
  });

  it('gives the date a recording opens on', () => {
    const panel = recording({
      recording: { ...RECORDING, availableFromMs: Date.UTC(2027, 6, 1) },
      nowMs: Date.UTC(2027, 5, 1),
    });
    expect(panel?.embedUrl).toBeNull();
    expect(panel?.message).toBe('This recording opens on 1 July 2027.');
  });

  it('reads a refusal as a ticket answer', () => {
    const panel = recording({
      outcome: 'denied',
      recording: null,
      allowed: ['All Access (VIP)', 'Gold', 'Main Conference'],
    });
    expect(panel?.barred).toBe(true);
    expect(panel?.message).toBe(
      'This recording is included with All Access (VIP), Gold and Main Conference tickets. Your ticket is Startup Table.',
    );
  });
});

describe('watchRowTag', () => {
  it('is silent when nothing is restricted', () => {
    expect(watchRowTag([], 'Startup Table', true)).toBeNull();
  });

  it('is silent for a ticket that is on the list', () => {
    expect(watchRowTag(['Gold', 'Startup Table'], 'Startup Table', true)).toBeNull();
  });

  it('warns a ticket that is not', () => {
    expect(watchRowTag(['Gold'], 'Startup Table', true)).toBe('Not on your ticket');
  });

  it('says nothing when the reader’s own ticket could not be read', () => {
    // A row that bars somebody because its own lookup failed is worse than one
    // that lets them tap and be told no by the rules, which is the rule
    // `useSessionSeat` already follows.
    expect(watchRowTag(['Gold'], null, false)).toBeNull();
  });
});

describe('groupWatchable', () => {
  const NOW = Date.UTC(2027, 5, 1);
  type Talk = WatchCandidate & { id: string };
  const talks = (rows: Talk[]) => rows;

  it('puts a session that streamed and was recorded in both lists', () => {
    const groups = groupWatchable(
      talks([
        {
          id: 'a',
          streamState: 'live',
          hasRecording: true,
          recordingUntilMs: Date.UTC(2027, 11, 31),
        },
      ]),
      'Startup Table',
      true,
      NOW,
    );
    expect(groups.live.map((r) => r.item.id)).toEqual(['a']);
    expect(groups.recordings.map((r) => r.item.id)).toEqual(['a']);
    expect(groups.upcoming).toEqual([]);
  });

  it('keeps the stream and the recording restrictions apart', () => {
    // The ordinary arrangement here: the talk streams to everybody and the
    // recording was sold with the video library. One union would put "not on
    // your ticket" on a stream anybody may watch.
    const groups = groupWatchable(
      talks([
        {
          id: 'a',
          streamState: 'live',
          hasRecording: true,
          streamTicketTypes: [],
          recordingTicketTypes: ['All Access (VIP)'],
        },
      ]),
      'Startup Table',
      true,
      NOW,
    );
    expect(groups.live[0]?.tag).toBeNull();
    expect(groups.recordings[0]?.tag).toBe('Not on your ticket');
  });

  it('lists a closed recording with the date it closed, rather than dropping it', () => {
    const groups = groupWatchable(
      talks([{ id: 'a', hasRecording: true, recordingUntilMs: Date.UTC(2027, 2, 1) }]),
      'Gold',
      true,
      NOW,
    );
    expect(groups.recordings).toHaveLength(1);
    expect(groups.recordings[0]?.closed).toBe(true);
    expect(groups.recordings[0]?.note).toBe('Closed 1 March 2027');
  });

  it('shows the expiry on a recording that is still open', () => {
    const groups = groupWatchable(
      talks([{ id: 'a', hasRecording: true, recordingUntilMs: Date.UTC(2027, 11, 31) }]),
      'Gold',
      true,
      NOW,
    );
    expect(groups.recordings[0]?.closed).toBe(false);
    expect(groups.recordings[0]?.note).toBe('Available until 31 December 2027');
  });

  it('leaves a session with nothing set up out of all three lists', () => {
    const groups = groupWatchable(talks([{ id: 'a' }]), 'Gold', true, NOW);
    expect(groups).toEqual({ live: [], upcoming: [], recordings: [] });
  });

  it('separates what is on now from what is coming up', () => {
    const groups = groupWatchable(
      talks([
        { id: 'now', streamState: 'live' },
        { id: 'later', streamState: 'scheduled' },
        { id: 'over', streamState: 'ended' },
      ]),
      'Gold',
      true,
      NOW,
    );
    expect(groups.live.map((r) => r.item.id)).toEqual(['now']);
    expect(groups.upcoming.map((r) => r.item.id)).toEqual(['later']);
    // A finished stream with no recording is on neither list: there is nothing
    // to watch, and a row that opens a screen saying so is a row that lies.
    expect(groups.recordings).toEqual([]);
  });
});
