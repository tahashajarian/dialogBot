const { classifyHomeMessage } = require('./home-intent');

const FEEDBACK_PATTERN = /(?:کیرم دهنت|کص|کسخل|احمق|خنگ|گیج(?:ی|ه| میزنی| می‌زنی)?|بد حرف می.?زنی|بد جواب می.?دی|جوابت خوب نبود|چه ربطی داشت|ربطی نداشت|که نمی.?تونی|تو نمی.?تونی|you(?:'re| are) (?:stupid|dumb|confused|useless)|what did that have to do with it|bad answer)/i;
const PEOPLE_HELP_PATTERN = /(?:بخش\s*(?:آدم(?:‌?ها)?|افراد)|(?:آدم|افراد)\s*جدید|دیدن\s*آدم(?:‌?ها)?|people\s*section|new\s*people|see\s*people)/i;
const DISCUSSION_HELP_PATTERN = /(?:تو|توی|داخل)\s*گفت(?:‌?وگو|گو)(?:ها)?\s*(?:گیج|سردرگم|گم)\s*(?:شدم|هستم)|(?:گفت(?:‌?وگو|گو)(?:ها)?).{0,24}(?:چطور کار می.?کنه|راهنما|کمک|نمی.?فهمم)|(?:confused|lost).{0,20}(?:discussion|conversation)|(?:how do|how does).{0,20}(?:discussion|conversation).{0,20}(?:work|section)/i;

function routeHomeMessage(text, baseIntent = classifyHomeMessage(text)) {
  const normalized = String(text || '').trim().slice(0, 1000);
  if (baseIntent.immediateSafety) return Object.freeze({ kind: 'safety', intent: baseIntent });
  if (baseIntent.personalDistress) return Object.freeze({ kind: 'personal_boundary', intent: baseIntent });
  if (PEOPLE_HELP_PATTERN.test(normalized)) {
    return Object.freeze({
      kind: 'product_help',
      section: 'people',
      intent: Object.freeze({
        ...baseIntent,
        outOfScope: false,
        productRelated: true,
        discussionStatus: false,
        discussionMembers: false,
        discussionMembersFollowup: false,
        topics: ['people'],
        productHelpSection: 'people',
        snapshot: Object.freeze({ identity: true }),
      }),
    });
  }
  if (DISCUSSION_HELP_PATTERN.test(normalized)) {
    return Object.freeze({
      kind: 'product_help',
      section: 'discussions',
      intent: Object.freeze({
        ...baseIntent,
        outOfScope: false,
        productRelated: true,
        discussionStatus: false,
        discussionMembers: false,
        discussionMembersFollowup: false,
        topics: ['discussions'],
        productHelpSection: 'discussions',
        snapshot: Object.freeze({ identity: true }),
      }),
    });
  }
  if (FEEDBACK_PATTERN.test(normalized) || baseIntent.feedback || baseIntent.reaction) {
    return Object.freeze({ kind: 'feedback', intent: Object.freeze({ ...baseIntent, feedback: true, discussionStatus: false, discussionMembers: false }) });
  }
  if (baseIntent.outOfScope) return Object.freeze({ kind: 'out_of_scope', intent: baseIntent });
  if (baseIntent.exactGreeting || baseIntent.thanks || baseIntent.socialCheckIn) return Object.freeze({ kind: 'social', intent: baseIntent });
  if (baseIntent.recommendation) return Object.freeze({ kind: 'recommendation', section: baseIntent.recommendationSection, intent: baseIntent });
  const needsData = Object.entries(baseIntent.snapshot || {}).some(([key, value]) => key !== 'identity' && Boolean(value));
  if (needsData) return Object.freeze({ kind: 'product_data', intent: baseIntent });
  return Object.freeze({ kind: 'product_conversation', intent: baseIntent });
}

module.exports = { routeHomeMessage, FEEDBACK_PATTERN, DISCUSSION_HELP_PATTERN, PEOPLE_HELP_PATTERN };
