const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/user");
const ModerationAction = require("../src/models/moderation-action");
const {
  normalizeReason,
  normalizeUserId,
  unbanUser,
} = require("../src/services/moderation-admin");
const { anonymizeModerationActions } = require("../src/services/account-deletion");

function queryResult(value) {
  return {
    select() { return this; },
    lean: async () => value,
  };
}

test("moderation admin validates user ids and review reasons", () => {
  assert.equal(normalizeUserId("123"), 123);
  assert.equal(normalizeUserId("nope"), null);
  assert.equal(normalizeUserId("-1"), null);
  assert.equal(normalizeReason("  reviewed   false positive  "), "reviewed false positive");
});

test("audited unban clears only ban fields", async (t) => {
  const original = {
    findOne: User.findOne,
    findOneAndUpdate: User.findOneAndUpdate,
    create: ModerationAction.create,
    updateOne: ModerationAction.updateOne,
  };
  t.after(() => {
    User.findOne = original.findOne;
    User.findOneAndUpdate = original.findOneAndUpdate;
    ModerationAction.create = original.create;
    ModerationAction.updateOne = original.updateOne;
  });

  const bannedAt = new Date("2026-08-20T10:00:00Z");
  let update;
  let auditCreated;
  let auditCompleted;
  User.findOne = () => queryResult({ userId: 123, bannedAt, banReason: "report_threshold", banSource: "auto_reports" });
  User.findOneAndUpdate = (filter, change) => {
    update = { filter, change };
    return queryResult({ userId: 123, bannedAt: null });
  };
  ModerationAction.create = async (value) => {
    auditCreated = value;
    return { _id: "audit-1" };
  };
  ModerationAction.updateOne = async (filter, change) => {
    auditCompleted = { filter, change };
  };

  const result = await unbanUser({
    targetUserId: 123,
    reason: "Reviewed false-positive reports",
    now: new Date("2026-08-27T10:00:00Z"),
  });

  assert.deepEqual(result, { ok: true, actionId: "audit-1", auditPending: false });
  assert.deepEqual(update.change, { $set: { bannedAt: null, banReason: "", banSource: "" } });
  assert.equal(Object.hasOwn(update.change.$set, "activeDiscussionId"), false);
  assert.equal(Object.hasOwn(update.change.$set, "reportReporterUserIds"), false);
  assert.equal(auditCreated.previousBan.source, "auto_reports");
  assert.equal(auditCompleted.change.$set.status, "applied");
});

test("unban rejects users who are not currently banned", async (t) => {
  const originalFindOne = User.findOne;
  const originalCreate = ModerationAction.create;
  t.after(() => {
    User.findOne = originalFindOne;
    ModerationAction.create = originalCreate;
  });
  User.findOne = () => queryResult({ userId: 123, bannedAt: null });
  ModerationAction.create = async () => assert.fail("must not create an audit for a no-op");

  assert.deepEqual(
    await unbanUser({ targetUserId: 123, reason: "Reviewed and reversed ban" }),
    { ok: false, reason: "not_banned" },
  );
});

test("account deletion anonymizes moderation actions and clears review text", async (t) => {
  const originalUpdateMany = ModerationAction.updateMany;
  t.after(() => { ModerationAction.updateMany = originalUpdateMany; });
  let mutation;
  ModerationAction.updateMany = async (filter, update) => { mutation = { filter, update }; };

  await anonymizeModerationActions(123, -456);

  assert.deepEqual(mutation, {
    filter: { targetUserId: 123 },
    update: { $set: { targetUserId: -456, reason: "Account deleted" } },
  });
});
