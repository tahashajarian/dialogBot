const test = require("node:test");
const assert = require("node:assert/strict");

const messages = require("../src/messages");
const DiscussionBoost = require("../src/models/discussion-boost");
const { starEconomy } = require("../src/services/star-settings");
const {
  buildDiscussionRoomKeyboard,
  formatDiscussionRoom,
  formatDiscussionRoomFollowup,
  formatRecentDiscussionMessages,
  formatDiscussionMemberLines,
  buildDiscussionMembersText,
} = require("../src/services/discussion-room-ui");

test("rebuilding a boosted owner room keyboard keeps Boost hidden", async () => {
  const originalFindOne = DiscussionBoost.findOne;
  const originalSettings = {
    economyEnabled: starEconomy.economyEnabled,
    spendingEnabled: starEconomy.spendingEnabled,
    boostEnabled: starEconomy.boostEnabled,
  };
  Object.assign(starEconomy, { economyEnabled: true, spendingEnabled: true, boostEnabled: true });
  DiscussionBoost.findOne = () => ({
    select: () => ({ lean: async () => ({ _id: "active-boost" }) }),
  });

  try {
    const keyboard = await buildDiscussionRoomKeyboard("en", {
      _id: "507f1f77bcf86cd799439011",
      creatorUserId: 10,
    }, 10);
    const labels = keyboard.reply_markup.keyboard.flat().map((button) => button.text);
    assert.equal(labels.includes(messages.en.discussionBoostButton), false);
  } finally {
    DiscussionBoost.findOne = originalFindOne;
    Object.assign(starEconomy, originalSettings);
  }
});

test("formatDiscussionRoom renders title, description, and counts", () => {
  const text = formatDiscussionRoom(messages, "en", {
    title: "Best Albums",
    description: "Metal only",
    memberUserIds: [1, 2],
    maxMembers: 20,
  });
  assert.match(text, /Best Albums/);
  assert.match(text, /📄 Metal only/);
  assert.match(text, /2\/20/);
});

test("formatDiscussionRoom localizes bot-created rooms and uses only the bot emoji marker", () => {
  const discussion = {
    title: "Movie Chat",
    description: "Chat about movies, scenes, and recent favorites.",
    isBotCreated: true,
    botSeedKey: "lets-talk",
    memberUserIds: [],
    maxMembers: 20,
  };
  const text = formatDiscussionRoom(messages, "en", discussion);
  const persianText = formatDiscussionRoom(messages, "fa", discussion);

  assert.match(text, /💬 👩‍🦳 Movies & Series Chat/);
  assert.match(text, /Chat about movies, series, scenes, episodes, and recent favorites/);
  assert.match(persianText, /💬 👩‍🦳 گفت‌وگوی فیلم/);
  assert.match(persianText, /برای گپ درباره فیلم‌ها، سریال‌ها، سکانس‌ها، قسمت‌ها و چیزهایی که دوست داشتید/);
  assert.doesNotMatch(text, /official/i);
});

test("formatRecentDiscussionMessages handles empty and populated lists", () => {
  const empty = formatRecentDiscussionMessages(messages, "en", { recentMessages: [] });
  assert.match(empty, /No messages yet/);

  const populated = formatRecentDiscussionMessages(messages, "en", {
    recentMessages: [{ senderDisplayName: "Ali", text: "Hello" }],
  });
  assert.match(populated, /Ali: Hello/);
});

test("formatDiscussionRoomFollowup adds a quiet starter-room nudge only for bot rooms", () => {
  const gaming = formatDiscussionRoomFollowup(messages, "en", {
    isBotCreated: true,
    botSeedKey: "whats-up",
    recentMessages: [],
  });
  const regular = formatDiscussionRoomFollowup(messages, "en", {
    isBotCreated: false,
    recentMessages: [],
  });

  assert.match(gaming, /From now on, normal text messages go to this discussion/);
  assert.match(gaming, /Say hi\./);
  assert.doesNotMatch(regular, /Say hi/);
});

test("formatDiscussionMemberLines marks host with host badge", () => {
  const lines = formatDiscussionMemberLines(messages, "en", [
    { userId: 10, profileName: "Owner", publicProfileCode: "u_A1" },
    { userId: 11, profileName: "Member", publicProfileCode: "u_B2" },
  ], 10);
  assert.match(lines[0], /Owner — 🎙️ host/);
  assert.match(lines[1], /👁 View profile 👈 \/u_B2/);
  assert.match(lines[1], /🚩 Report 👈 \/report_B2/);
});

test("formatDiscussionMemberLines shows profile emoji for other members", () => {
  const lines = formatDiscussionMemberLines(messages, "en", [
    { userId: 10, profileName: "Owner", profileEmoji: "🎧", publicProfileCode: "u_A1" },
    { userId: 11, profileName: "Member", profileEmoji: "💠", publicProfileCode: "u_B2" },
  ], 10, 10);

  assert.match(lines[0], /You/);
  assert.doesNotMatch(lines[0], /🎧/);
  assert.match(lines[1], /Member 💠/);
});

test("formatDiscussionMemberLines does not show presence marker", () => {
  const lines = formatDiscussionMemberLines(messages, "en", [
    { userId: 10, profileName: "Owner", publicProfileCode: "u_A1", activeDiscussionId: "d1" },
    { userId: 11, profileName: "Member", publicProfileCode: "u_B2", activeDiscussionId: "d1" },
  ], 10, 11, "d1");

  assert.doesNotMatch(lines.join("\n"), /🟢/);
});

test("formatDiscussionMemberLines shows current user without profile code", () => {
  const lines = formatDiscussionMemberLines(messages, "en", [
    { userId: 10, profileName: "Owner", publicProfileCode: "u_A1" },
    { userId: 11, profileName: "Member", publicProfileCode: "u_B2" },
  ], 10, 11);

  assert.match(lines[1], /^2\.\n👤 You\n─+$/);
});

test("formatDiscussionMemberLines lets owner remove other members", () => {
  const lines = formatDiscussionMemberLines(messages, "en", [
    { userId: 10, profileName: "Owner", publicProfileCode: "u_A1" },
    { userId: 11, profileName: "Member", publicProfileCode: "u_B2" },
  ], 10, 10);

  assert.match(lines[1], /👁 View profile 👈 \/u_B2/);
  assert.match(lines[1], /🚩 Report 👈 \/report_B2/);
  assert.match(lines[1], /🗑 Remove 👈 \/remove_B2/);
});

test("formatDiscussionMemberLines separates member blocks with dividers", () => {
  const lines = formatDiscussionMemberLines(messages, "en", [
    { userId: 10, profileName: "Owner", publicProfileCode: "u_A1" },
    { userId: 11, profileName: "Member", publicProfileCode: "u_B2" },
  ], 10, 10);

  assert.match(lines.join("\n"), /You[\s\S]*────────[\s\S]*Member/);
  assert.match(lines.at(-1), /────────$/);
});

test("formatDiscussionMemberLines uses Persian digits in fa", () => {
  const lines = formatDiscussionMemberLines(messages, "fa", [
    { userId: 10, profileName: "علی", publicProfileCode: "u_A1" },
    { userId: 11, profileName: "Sara", publicProfileCode: "u_B2" },
  ], 10, 10);

  assert.match(lines[0], /۱\./);
  assert.match(lines[1], /۲\./);
});

test("discussion member lists are visibly bot-authored", () => {
  assert.equal(buildDiscussionMembersText(messages, "en", ["1. Member"]), `👩‍🦳 ${messages.en.discussionMembersTitle} (1)\n\n1. Member`);
  assert.match(buildDiscussionMembersText(messages, "fa", []), /^👩‍🦳/);
  assert.match(buildDiscussionMembersText(messages, "fa", ["one", "two", "three"]), /اعضا \(۳\)/);
});

test("discussion member lists explain profile commands only when another profile is viewable", () => {
  const english = buildDiscussionMembersText(messages, "en", [
    "1.\n👤 You",
    "2.\n👤 Sam\n👁 View profile 👈 /u_AB12",
  ]);
  const persian = buildDiscussionMembersText(messages, "fa", [
    "۱.\n👤 تو",
    "۲.\n👤 سارا\n👁 دیدن پروفایل 👈 /u_CD34",
  ]);
  const alone = buildDiscussionMembersText(messages, "en", ["1.\n👤 You"]);

  assert.match(english, /💡 You can use View profile/);
  assert.match(persian, /💡 می‌تونی با دستور «دیدن پروفایل»/);
  assert.doesNotMatch(alone, /discussionMembersTip|View profile/);
});
