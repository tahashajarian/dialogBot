const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const { callBacks } = require("../src/constants");
const UserModel = require("../src/models/user");
const { isPeopleCallback } = require("../src/services/people-discovery-ui");
const { operationalLimits } = require("../src/services/operational-limits");
const {
  getPeopleDiscoveryMinSharedItems,
  getSharedSections,
} = require("../src/services/people-discovery");
const {
  DEFAULT_COOLDOWN_DAYS,
  MILLISECONDS_PER_DAY,
  findNewSimilarPeople,
  flushSimilarPeopleReengagement,
  getMatchCutoff,
  getSimilarPeopleReengagementPreview,
  inactiveCandidateQuery,
  isUserInRollout,
  notificationKeyboard,
  touchUserActivity,
} = require("../src/services/similar-people-reengagement");

let originalEnabled;
let originalRolloutPercent;

test.beforeEach(() => {
  originalEnabled = operationalLimits.similarPeopleReengagementEnabled;
  originalRolloutPercent = operationalLimits.similarPeopleReengagementRolloutPercent;
  operationalLimits.similarPeopleReengagementEnabled = true;
  operationalLimits.similarPeopleReengagementRolloutPercent = 100;
});

test.afterEach(() => {
  operationalLimits.similarPeopleReengagementEnabled = originalEnabled;
  operationalLimits.similarPeopleReengagementRolloutPercent = originalRolloutPercent;
});

test("new similar people reuse discovery with the newest activity watermark", async () => {
  const lastActiveAt = new Date("2026-06-01T00:00:00Z");
  const lastNotifiedAt = new Date("2026-06-03T00:00:00Z");
  let options;
  const matches = await findNewSimilarPeople({
    userId: 7,
    lastActiveAt,
    similarPeopleLastNotifiedAt: lastNotifiedAt,
  }, {
    findPeopleBySharedTaste: async (_viewer, received) => {
      options = received;
      return {
        ok: true,
        items: [
          { userId: 8, isSaved: false },
          { userId: 9, isSaved: true },
        ],
      };
    },
  });

  assert.equal(
    getMatchCutoff({ lastActiveAt, similarPeopleLastNotifiedAt: lastNotifiedAt }).getTime(),
    lastNotifiedAt.getTime(),
  );
  assert.equal(options.candidateCreatedAfter.getTime(), lastNotifiedAt.getTime());
  assert.equal(options.track, false);
  assert.equal(Object.hasOwn(options, "minSharedItems"), false);
  assert.deepEqual(matches.map((entry) => entry.userId), [8]);
});

test("notification matching honors the dashboard minimum shared-item setting", async () => {
  const originalMinimum = operationalLimits.peopleDiscoveryMinSharedItems;
  operationalLimits.peopleDiscoveryMinSharedItems = 3;

  try {
    assert.equal(getPeopleDiscoveryMinSharedItems(), 3);
    assert.deepEqual(
      getSharedSections(
        { music: ["a", "b", "c"] },
        { music: ["a", "b"] },
      ),
      [],
    );
    assert.equal(
      getSharedSections(
        { music: ["a", "b", "c"] },
        { music: ["a", "b", "c"] },
      )[0].count,
      3,
    );
  } finally {
    operationalLimits.peopleDiscoveryMinSharedItems = originalMinimum;
  }
});

test("inactive candidate query accepts separate inactivity and cooldown day settings", () => {
  const now = new Date("2026-07-28T12:00:00Z");
  const query = inactiveCandidateQuery(now, 7, DEFAULT_COOLDOWN_DAYS);
  assert.equal(query.lastActiveAt.$lte.getTime(), now.getTime() - 7 * MILLISECONDS_PER_DAY);
  const cooldownBranch = query.$and[1].$or.find((entry) => entry.similarPeopleLastNotifiedAt?.$lte);
  assert.equal(
    cooldownBranch.similarPeopleLastNotifiedAt.$lte.getTime(),
    now.getTime() - 3 * MILLISECONDS_PER_DAY,
  );
  assert.equal(query.similarPeopleNotificationsEnabled.$ne, false);
});

test("delivery stays disabled until the admin enables rollout", async () => {
  operationalLimits.similarPeopleReengagementEnabled = false;
  let databaseReads = 0;
  const result = await flushSimilarPeopleReengagement({
    messages,
    sendToUser: async () => true,
    deps: {
      User: {
        find: () => {
          databaseReads += 1;
          return null;
        },
      },
    },
  });
  assert.deepEqual(result, { scanned: 0, sent: 0 });
  assert.equal(databaseReads, 0);
});

test("rollout assignment is deterministic and respects zero or full rollout", () => {
  assert.equal(isUserInRollout(123, 0), false);
  assert.equal(isUserInRollout(123, 100), true);
  assert.equal(isUserInRollout(123, 10), isUserInRollout(123, 10));
});

test("dashboard preview counts the bounded rollout batch and verified matches without sending", async () => {
  operationalLimits.similarPeopleReengagementEnabled = false;
  operationalLimits.similarPeopleReengagementRolloutPercent = 100;
  const users = [
    { userId: 1, lastActiveAt: new Date("2026-07-01"), similarPeopleLastNotifiedAt: null },
    { userId: 2, lastActiveAt: new Date("2026-07-01"), similarPeopleLastNotifiedAt: null },
  ];
  const User = {
    countDocuments: async () => 12,
    find: () => ({
      select() { return this; },
      sort() { return this; },
      limit() { return this; },
      async lean() { return users; },
    }),
  };
  const preview = await getSimilarPeopleReengagementPreview({
    now: new Date("2026-07-28"),
    force: true,
    deps: {
      User,
      findPeopleBySharedTaste: async (user) => ({
        ok: true,
        items: user.userId === 1 ? [{ userId: 9, isSaved: false }] : [],
      }),
    },
  });
  assert.equal(preview.enabled, false);
  assert.equal(preview.inactiveUsers, 12);
  assert.equal(preview.nextBatchUsers, 2);
  assert.equal(preview.nextBatchMatchingUsers, 1);
  assert.equal(preview.minimumSharedItems, operationalLimits.peopleDiscoveryMinSharedItems);
});

test("activity writes are hourly bounded", async () => {
  const updates = [];
  const User = { updateOne: async (...args) => updates.push(args) };
  const now = new Date("2026-07-28T12:00:00Z");
  const recent = { userId: 1, lastActiveAt: new Date("2026-07-28T11:30:00Z") };
  const stale = { userId: 2, lastActiveAt: new Date("2026-07-28T10:00:00Z") };

  assert.equal(await touchUserActivity(recent, now, { User }), false);
  assert.equal(await touchUserActivity(stale, now, { User }), true);
  assert.equal(updates.length, 1);
  assert.equal(stale.lastActiveAt, now);
});

test("notification copy opens normal People discovery", () => {
  const keyboard = notificationKeyboard(messages, "fa");
  assert.equal(
    keyboard.reply_markup.inline_keyboard[0][0].callback_data,
    callBacks.peopleSimilarReengagementOpen,
  );
  assert.equal(isPeopleCallback(callBacks.peopleSimilarReengagementOpen), true);
  assert.equal(keyboard.reply_markup.inline_keyboard[0][0].text, messages.fa.similarPeopleNotificationOpen);
  assert.doesNotMatch(messages.fa.similarPeopleNotification, /\d|اسم|علاقه‌ی مشترک/);
});

test("user schema indexes inactive re-engagement scans", () => {
  const index = UserModel.schema.indexes().find(([, options]) =>
    options?.name === "similar_people_reengagement_candidates"
  );
  assert.ok(index);
  assert.equal(index[0].lastActiveAt, 1);
  assert.equal(index[0].similarPeopleLastNotifiedAt, 1);
});

test("flush sends once and records a successful claim", async () => {
  const now = new Date("2026-07-28T12:00:00Z");
  const user = {
    userId: 7,
    lang: "fa",
    lastActiveAt: new Date("2026-07-01T12:00:00Z"),
    similarPeopleLastNotifiedAt: null,
    savedProfileCodes: [],
  };
  const updates = [];
  const User = {
    find: () => ({
      select() { return this; },
      sort() { return this; },
      limit() { return this; },
      async lean() { return [user]; },
    }),
    findOneAndUpdate: (_filter, update) => ({
      async lean() {
        return { ...user, ...update.$set };
      },
    }),
    updateOne: async (filter, update) => {
      updates.push({ filter, update });
      return { acknowledged: true };
    },
  };
  const sends = [];
  const result = await flushSimilarPeopleReengagement({
    now,
    messages,
    sendToUser: async (...args) => {
      sends.push(args);
      return { message_id: 1 };
    },
    deps: {
      User,
      findPeopleBySharedTaste: async () => ({ ok: true, items: [{ userId: 8, isSaved: false }] }),
      trackEvent: async () => null,
    },
  });

  assert.deepEqual(result, { scanned: 1, sent: 1 });
  assert.equal(sends.length, 1);
  assert.equal(sends[0][0], 7);
  assert.equal(sends[0][1], messages.fa.similarPeopleNotification);
  assert.equal(updates.at(-1).update.$set.similarPeopleLastNotifiedAt, now);
  assert.equal(updates.at(-1).update.$set.similarPeopleNotificationClaimToken, "");
});

test("flush restores the claim when Telegram delivery fails", async () => {
  const now = new Date("2026-07-28T12:00:00Z");
  const user = {
    userId: 7,
    lang: "en",
    lastActiveAt: new Date("2026-07-01T12:00:00Z"),
    similarPeopleLastNotifiedAt: null,
  };
  const updates = [];
  const User = {
    find: () => ({
      select() { return this; },
      sort() { return this; },
      limit() { return this; },
      async lean() { return [user]; },
    }),
    findOneAndUpdate: () => ({ async lean() { return user; } }),
    updateOne: async (_filter, update) => updates.push(update),
  };
  const result = await flushSimilarPeopleReengagement({
    now,
    messages,
    sendToUser: async () => false,
    deps: {
      User,
      findPeopleBySharedTaste: async () => ({ ok: true, items: [{ userId: 8, isSaved: false }] }),
    },
  });

  assert.deepEqual(result, { scanned: 1, sent: 0 });
  assert.equal(updates.at(-1).$set.similarPeopleNotificationClaimToken, "");
  assert.equal(updates.at(-1).$set.similarPeopleNotificationClaimedAt, null);
  assert.equal(updates.at(-1).$set.similarPeopleLastNotifiedAt, undefined);
});
