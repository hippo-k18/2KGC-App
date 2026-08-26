import { initializeApp } from 'firebase-admin/app';

initializeApp();

export { onPollVoteWrite } from './triggers/on-poll-vote-write.js';
export { onQuestionUpvoteWrite } from './triggers/on-question-upvote-write.js';
export { onReactionWrite } from './triggers/on-reaction-write.js';
export { onReplyWrite } from './triggers/on-reply-write.js';
export { tallyPoll } from './triggers/tally-poll.js';
