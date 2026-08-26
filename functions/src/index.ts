import { initializeApp } from 'firebase-admin/app';

initializeApp();

export { onQuestionUpvoteWrite } from './triggers/on-question-upvote-write.js';
export { onReactionWrite } from './triggers/on-reaction-write.js';
export { onReplyWrite } from './triggers/on-reply-write.js';
