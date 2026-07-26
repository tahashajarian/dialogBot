const test = require("node:test");
const assert = require("node:assert/strict");
const { setImmediate } = require("node:timers");
const axios = require("axios");

const messages = require("../src/messages");
const User = require("../src/models/user");
const { botAppearance, FIXED_RESERVED_EMOJIS } = require("../src/services/bot-appearance");
const { starEconomy } = require("../src/services/star-settings");
const { getProfileEmojiIndex, getProfileEmojiOptions } = require("../src/services/profile-emoji");
const {
  profileKeyboard,
  profileInterestsKeyboard,
  profileQuickActionsKeyboard,
  profilePrivacySafetyKeyboard,
  profileInvitationRestrictionsKeyboard,
  ageKeyboard,
  ageRangeKeyboard,
  profileEmojiKeyboard,
  profileEmojiConfirmKeyboard,
  profileEmojiInsufficientKeyboard,
  profileActiveDiscussionHelpKeyboard,
} = require("../src/keyboards");
const { callBacks } = require("../src/constants");
const {
  isValidProfileAge,
  isValidProfileAgeRangeStart,
} = require("../src/services/profile-age");
const {
  buildProfileText,
  sendProfileMessage,
  saveLocationProfile,
  sanitizeProfileNameCandidate,
  validateProfileName,
  isValidTextInput,
} = require("../src/services/profile");
const { extractCityFromReverseGeocode } = require("../src/services/location");
const { buildInvitationRestrictionsView } = require("../src/services/profile-privacy-ui");
const { handleProfileCancelText, handleProfileText } = require("../src/flows/profile-text");

const user = {
  firstName: "Ali",
  profileName: "Ali",
  showActiveDiscussionOnProfile: true,
};

test("new users show profile discussions and Favorites by default", () => {
  const newUser = new User({ userId: 123 });
  assert.equal(newUser.showActiveDiscussionOnProfile, true);
  assert.equal(newUser.showFavoritesOnProfile, true);
});

test("buildProfileText shows profile visibility settings only for own profile", () => {
  const ownText = buildProfileText({
    ...user,
    starBalance: 18,
    showProfileInPeopleDiscovery: false,
  }, "en", messages, { isOwnProfile: true });
  const acknowledgedText = buildProfileText({
    ...user,
    starBalance: 18,
    activeDiscussionHelpAcknowledgedAt: new Date(),
  }, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(user, "en", messages, { isOwnProfile: false });

  assert.match(ownText, /⭐ Stars: 18/);
  assert.match(ownText, new RegExp(messages.en.profileOwnerTip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(ownText, /Show in See People: Off/);
  assert.match(ownText, /Show Favorites: On/);
  assert.match(ownText, /Show discussions/);
  assert.match(ownText, /What is this\? \/ad_help/);
  assert.match(acknowledgedText, /Show discussions/);
  assert.doesNotMatch(acknowledgedText, /\/ad_help/);
  assert.doesNotMatch(publicText, /Show discussions/);
  assert.doesNotMatch(publicText, /Show in See People/);
  assert.doesNotMatch(publicText, /Show Favorites/);
  assert.doesNotMatch(publicText, /\/ad_help/);
  assert.doesNotMatch(publicText, /Stars:/);
  assert.equal(publicText.includes(messages.en.profileOwnerTip), false);
});

test("buildProfileText treats missing legacy visibility settings as on", () => {
  const text = buildProfileText({ profileName: "Ali" }, "fa", messages, { isOwnProfile: true });

  assert.match(text, /👀 نمایش در «دیدن آدم‌ها»: روشن/);
  assert.match(text, /❤️ نمایش محبوب‌ها: روشن/);
  assert.match(text, /💬 نمایش گفت‌وگوها: روشن/);
});

test("buildProfileText shows one private growth hint only on own profile", () => {
  const profileUser = {
    firstName: "Ali",
    profileName: "Ali",
    starBalance: 0,
    showActiveDiscussionOnProfile: false,
    aiLists: { random: { topTen: [{ title: "Chess" }] } },
  };
  const ownText = buildProfileText(profileUser, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(profileUser, "en", messages, { isOwnProfile: false });

  assert.match(ownText, /Add 2 more Interests/);
  assert.match(ownText, /\n\n💡 Add 2 more Interests[^\n]*$/);
  assert.doesNotMatch(publicText, /Add 2 more Interests/);
});

test("Persian own-profile growth hint is a separated footer without extra wording", () => {
  const profileUser = {
    firstName: "علی",
    profileName: "علی",
    aiLists: { random: { topTen: [] } },
  };

  const ownText = buildProfileText(profileUser, "fa", messages, { isOwnProfile: true });
  const publicText = buildProfileText(profileUser, "fa", messages, { isOwnProfile: false });

  assert.match(ownText, /\n\n‏💡 ۳ علاقه‌مندی دیگه اضافه کن تا پروفایلت دقیق‌تر بشه\.$/);
  assert.doesNotMatch(ownText, /قدم بعدی/);
  assert.doesNotMatch(publicText, /علاقه‌مندی دیگه/);
});

test("profile growth hints name one concrete missing field", () => {
  const threeItems = [{ title: "One" }, { title: "Two" }, { title: "Three" }];
  const profileUser = {
    firstName: "Ali",
    profileName: "Ali",
    bio: "Books and music",
    aiLists: {
      random: { topTen: threeItems },
      movies: { topTen: threeItems },
      music: { topTen: threeItems },
      books: { topTen: threeItems },
    },
  };
  const text = buildProfileText(profileUser, "en", messages, { isOwnProfile: true });
  assert.match(text, /Add your city to make your profile more useful/);
  assert.doesNotMatch(text, /more profile fields|Next:/);
});

test("buildProfileText uses public title when viewing someone else", () => {
  const ownText = buildProfileText(user, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(user, "en", messages, { isOwnProfile: false });
  const publicTextFa = buildProfileText(user, "fa", messages, { isOwnProfile: false });

  assert.match(ownText, /Your profile:/);
  assert.match(publicText, /User profile:/);
  assert.doesNotMatch(publicText, /Your profile:/);
  assert.match(publicTextFa, /پروفایل کاربر:/);
  assert.doesNotMatch(publicTextFa, /پروفایل شما:/);
});

test("validateProfileName rejects emoji and keeps normal names", () => {
  assert.deepEqual(validateProfileName("Ali", 30), { ok: true, value: "Ali" });
  assert.deepEqual(validateProfileName("  علی   رضایی  ", 30), { ok: true, value: "علی رضایی" });
  assert.equal(validateProfileName("Al", 30).reason, "too_short");
  assert.equal(validateProfileName("Ali 😀", 30).reason, "emoji");
  assert.equal(validateProfileName("Sara 🌸", 30).reason, "emoji");
  assert.equal(validateProfileName("/start", 30).reason, "command_like");
  assert.equal(validateProfileName("https://taha-shajarian.ir", 30).reason, "link");
  assert.equal(validateProfileName("taha-shajarian.ir", 30).reason, "link");
  assert.equal(validateProfileName("taha@example.com", 30).reason, "link");
  assert.equal(validateProfileName("منشتسیبمنتشکمیبتشکسیبتشمکسیبت", 30).reason, "low_quality");
  assert.equal(validateProfileName("Sex Chat", 30).reason, "sensitive_content");
  assert.equal(validateProfileName("سکس چت", 30).reason, "sensitive_content");
  assert.equal(validateProfileName("پورن فارسی", 30).reason, "sensitive_content");
  assert.equal(validateProfileName("ارباب", 30).reason, "sensitive_content");
  assert.equal(validateProfileName("بی غیرت", 30).reason, "sensitive_content");
  assert.equal(validateProfileName("Slave Master", 30).reason, "sensitive_content");
  assert.equal(validateProfileName("Khaleh", 30).reason, "sensitive_content");
  assert.deepEqual(
    validateProfileName("محمدرضاپورابراهیمی", 30),
    { ok: true, value: "محمدرضاپورابراهیمی" },
  );
  assert.equal(isValidTextInput("/start", 120), false);
  assert.equal(sanitizeProfileNameCandidate("Ali 😀", 30), "Ali");
  assert.equal(sanitizeProfileNameCandidate("/start", 30), "");
  assert.equal(sanitizeProfileNameCandidate("😀", 30), "");
  assert.equal(sanitizeProfileNameCandidate("منشتسیبمنتشکمیبتشکسیبتشمکسیبت", 30), "");
  assert.equal(sanitizeProfileNameCandidate("NSFW", 30), "");
  assert.equal(sanitizeProfileNameCandidate("Jendeh", 30), "");
  assert.equal(sanitizeProfileNameCandidate("taha-shajarian.ir", 30), "");
});

test("buildProfileText hides empty badge section", () => {
  const noBadgeUser = {
    firstName: "Ali",
    profileName: "Ali",
    aiTaste: {},
  };
  const ownText = buildProfileText(noBadgeUser, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(noBadgeUser, "en", messages, { isOwnProfile: false });

  assert.doesNotMatch(ownText, /🏷 Taste labels/);
  assert.doesNotMatch(ownText, /You do not have a badge yet/);
  assert.doesNotMatch(publicText, /🏷 Taste labels/);
  assert.doesNotMatch(publicText, /No badge/);
  assert.doesNotMatch(publicText, /You do not have a badge yet/);
});

test("profile Interests never render a legacy Interests taste label", () => {
  const text = buildProfileText({
    firstName: "Ali",
    profileName: "Ali",
    aiLists: { random: { topTen: [{ title: "Gaming" }, { title: "Coffee" }] } },
    aiTaste: {
      random: { labelKey: "gamer", emoji: "🎮" },
      movies: { labelKey: "drama_lover", emoji: "🎭" },
    },
  }, "en", messages, { isOwnProfile: false });

  assert.match(text, /🌿 Interests/);
  assert.match(text, /🎬 Movies & Series: 🎭 Drama/);
  assert.doesNotMatch(text, /Gamer|🌿 Interests: 🎮/);
});

test("hidden Favorites keep taste labels visible to the owner but not public viewers", () => {
  const profileUser = {
    firstName: "Ali",
    profileName: "Ali",
    showFavoritesOnProfile: false,
    aiTaste: { movies: { labelKey: "drama_lover", emoji: "🎭" } },
  };

  const ownText = buildProfileText(profileUser, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(profileUser, "en", messages, { isOwnProfile: false });
  assert.match(ownText, /🎬 Movies & Series: 🎭 Drama/);
  assert.doesNotMatch(publicText, /🏷 Taste labels|🎬 Movies & Series: 🎭 Drama/);
});

test("buildProfileText shows compact interests preview", () => {
  const profileUser = {
    firstName: "Ali",
    profileName: "Ali",
    aiLists: {
      random: {
        topTen: [
          { title: "Chess" },
          { title: "Coffee" },
          { title: "Coding" },
          { title: "Photography" },
          { title: "Travel" },
          { title: "Cooking" },
        ],
      },
    },
  };

  const text = buildProfileText(profileUser, "en", messages, { isOwnProfile: false });

  assert.match(text, /🌿 Interests/);
  assert.match(text, /Chess, Coffee, Coding, Photography, Travel/);
  assert.doesNotMatch(text, /Cooking/);
});

test("buildProfileText shows profile emoji after name", () => {
  const text = buildProfileText({
    firstName: "Ali",
    profileName: "Ali",
    profileEmoji: "💠",
  }, "en", messages, { isOwnProfile: false });

  assert.match(text, /Name: Ali 💠/);
});

test("buildProfileText localizes built-in interest chips", () => {
  const profileUser = {
    firstName: "Ali",
    profileName: "Ali",
    aiLists: {
      random: {
        topTen: [
          { title: "فیلم" },
          { title: "Chess" },
          { title: "زبان‌آموزی" },
          { title: "Custom typed thing" },
        ],
      },
    },
  };

  const englishText = buildProfileText(profileUser, "en", messages, { isOwnProfile: false });
  const persianText = buildProfileText(profileUser, "fa", messages, { isOwnProfile: false });

  assert.match(englishText, /Movies, Chess, Languages, Custom typed thing/);
  assert.match(persianText, /فیلم/);
  assert.match(persianText, /شطرنج/);
  assert.match(persianText, /زبان‌آموزی/);
  assert.match(persianText, /Custom typed thing/);
});

test("buildProfileText hides empty interests section", () => {
  const emptyUser = {
    firstName: "Ali",
    profileName: "Ali",
    aiLists: { random: { topTen: [] } },
  };

  const ownText = buildProfileText(emptyUser, "en", messages, { isOwnProfile: true });
  const publicText = buildProfileText(emptyUser, "en", messages, { isOwnProfile: false });

  assert.doesNotMatch(ownText, /🌿 Interests/);
  assert.doesNotMatch(ownText, /You have not added interests yet/);
  assert.doesNotMatch(publicText, /🌿 Interests/);
  assert.doesNotMatch(publicText, /You have not added interests yet/);
});

test("buildProfileText omits unset optional profile rows", () => {
  const minimalUser = {
    firstName: "Ali",
    profileName: "Ali",
  };

  const text = buildProfileText(minimalUser, "en", messages, { isOwnProfile: false });

  assert.match(text, /👤 Name: Ali/);
  assert.doesNotMatch(text, /City:/);
  assert.doesNotMatch(text, /Age:/);
  assert.doesNotMatch(text, /Gender:/);
  assert.doesNotMatch(text, /Pet:/);
  assert.doesNotMatch(text, /Location:/);
  assert.doesNotMatch(text, /Bio:/);
  assert.doesNotMatch(text, /—/);
  assert.match(text, /━━━━━━━━━━━━━━━━━━━━━━━━━━━━/);
});

test("buildProfileText uses the wider visible divider for stable card width", () => {
  const text = buildProfileText({
    profileName: "Ali",
  }, "en", messages, { isOwnProfile: false });

  assert.match(text, /User profile:\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👤 Name: Ali/);
});

test("saveLocationProfile returns before background city lookup resolves", async () => {
  const updates = [];
  const states = [];
  const cityUpdates = [];
  let resolveLookup;
  const lookupPromise = new Promise((resolve) => {
    resolveLookup = resolve;
  });
  const location = await saveLocationProfile({
    userId: 123,
    locationMessage: { latitude: 35.7, longitude: 51.4 },
    updateProfileField: async (userId, field, value) => {
      updates.push({ userId, field, value });
    },
    updateUserState: async (userId, state) => {
      states.push({ userId, state });
    },
    updateLocationCityForSharedAt: async (userId, sharedAt, city) => {
      cityUpdates.push({ userId, sharedAt, city });
    },
    resolveCityByCoordinates: async () => lookupPromise,
  });

  assert.equal(location.city, null);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].field, "location");
  assert.equal(updates[0].value.city, null);
  assert.deepEqual(states, [{ userId: 123, state: "idle" }]);
  assert.equal(cityUpdates.length, 0);

  resolveLookup("Tehran");
  await lookupPromise;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(cityUpdates.length, 1);
  assert.equal(cityUpdates[0].city, "Tehran");
  assert.equal(cityUpdates[0].sharedAt, location.sharedAt);
});

test("saveLocationProfile records failed background city lookup once", async () => {
  const updates = [];
  const cityUpdates = [];
  const location = await saveLocationProfile({
    userId: 123,
    locationMessage: { latitude: 35.7, longitude: 51.4 },
    updateProfileField: async (userId, field, value) => {
      updates.push({ userId, field, value });
    },
    updateUserState: async () => {},
    updateLocationCityForSharedAt: async (userId, sharedAt, city) => {
      cityUpdates.push({ userId, sharedAt, city });
    },
    resolveCityByCoordinates: async () => null,
  });

  assert.equal(location.city, null);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].value.city, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cityUpdates.length, 1);
  assert.equal(cityUpdates[0].city, null);
});

test("extractCityFromReverseGeocode falls back to broader place fields", () => {
  assert.equal(extractCityFromReverseGeocode({ address: { municipality: "Tehran" } }), "Tehran");
  assert.equal(extractCityFromReverseGeocode({ address: { state: "Tehran Province" } }), "Tehran Province");
  assert.equal(extractCityFromReverseGeocode({ address: {} }), null);
});

test("sendProfileMessage skips loading and default photo for text-only profiles", async () => {
  const replies = [];
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: replies.length };
    },
    replyWithPhoto: async () => {
      throw new Error("text-only profile should not send a default photo");
    },
  };

  const sent = await sendProfileMessage({
    ctx,
    user,
    lang: "en",
    messages,
    loadingText: messages.en.profileLoading,
  });

  assert.equal(sent.message_id, 1);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /User profile:/);
  assert.doesNotMatch(replies[0].text, /Preparing profile/);
});

test("sendProfileMessage keeps loading only for custom profile photos", async () => {
  const replies = [];
  const photos = [];
  const deletedIds = [];
  const ctx = {
    reply: async (text, extra) => {
      replies.push({ text, extra });
      return { message_id: 10 };
    },
    replyWithPhoto: async (photo, extra) => {
      photos.push({ photo, extra });
      return { message_id: 11 };
    },
    deleteMessage: async (messageId) => {
      deletedIds.push(messageId);
      return true;
    },
  };

  const sent = await sendProfileMessage({
    ctx,
    user: { ...user, photoFileId: "photo-file-id" },
    lang: "en",
    messages,
    loadingText: messages.en.profileLoading,
  });

  assert.equal(sent.message_id, 11);
  assert.equal(replies[0].text, messages.en.profileLoading);
  assert.equal(photos[0].photo, "photo-file-id");
  assert.match(photos[0].extra.caption, /User profile:/);
  assert.deepEqual(deletedIds, [10]);
});

test("profileKeyboard puts remove photo beside change photo", () => {
  const keyboard = profileKeyboard("en", true);
  const rows = keyboard?.reply_markup?.keyboard || [];
  const photoRow = rows.find((row) => row.some((button) => button.text === messages.en.profileEditPhoto));

  assert.ok(photoRow);
  assert.deepEqual(photoRow.map((button) => button.text), [
    messages.en.profileEditPhoto,
    messages.en.profileResetPhoto,
  ]);
});

test("profileKeyboard offers Add photo before a profile photo exists", () => {
  const rows = profileKeyboard("en", false)?.reply_markup?.keyboard || [];
  const labels = rows.flat().map((button) => button.text);

  assert.ok(labels.includes(messages.en.profileAddPhoto));
  assert.ok(!labels.includes(messages.en.profileEditPhoto));
  assert.ok(!labels.includes(messages.en.profileResetPhoto));
});

test("profileKeyboard keeps only typed and media actions in compact rows", () => {
  const keyboard = profileKeyboard("en", true);
  const rows = keyboard?.reply_markup?.keyboard || [];
  const buttons = rows.flat();
  const labels = buttons.map((button) => button.text);
  const nameCityRow = rows.find((row) => row.some((button) => button.text === messages.en.profileEditName));
  const bioRow = rows.find((row) => row.some((button) => button.text === messages.en.profileEditBio));

  assert.ok(!labels.includes(messages.en.profileMoreSettings));
  assert.ok(labels.includes(messages.en.profileEditBio));
  assert.ok(!labels.includes(messages.en.profileEditPetPreference));
  assert.ok(!labels.includes(messages.en.profileEditLocation));
  assert.ok(!labels.includes(messages.en.profileEditAge));
  assert.ok(!labels.includes(messages.en.profileEditGender));
  assert.ok(!labels.includes(messages.en.profileEmojiButton));
  assert.deepEqual(nameCityRow.map((button) => button.text), [messages.en.profileEditName, messages.en.profileEditCity]);
  assert.deepEqual(bioRow.map((button) => button.text), [messages.en.profileEditBio]);
  assert.ok(!labels.includes(messages.en.profilePrivacySafetyButton));
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.length <= 2));
});

test("profile interests keep selected built-in chips in place", () => {
  const plainRows = profileInterestsKeyboard("en", [], 0).reply_markup.inline_keyboard;
  const selectedRows = profileInterestsKeyboard("en", [{ title: "Art" }], 0).reply_markup.inline_keyboard;
  const plainArt = plainRows.flat().find((button) => button.text.includes("Art"));
  const selectedArt = selectedRows.flat().find((button) => button.text.includes("Art"));

  assert.equal(plainRows[1][0], plainArt);
  assert.equal(selectedRows[1][0], selectedArt);
  assert.equal(selectedRows[1][0].text, `${plainRows[1][0].text} ✓`);
  assert.equal(selectedRows.at(-1)[0].callback_data, callBacks.profilePickerClose);
});

test("profile interests show the same four catalog rows as onboarding", () => {
  const rows = profileInterestsKeyboard("en", [], 0).reply_markup.inline_keyboard;
  const catalogRows = rows.filter((row) => row.some((button) => (
    button.callback_data?.startsWith(callBacks.profileInterestChip)
  )));

  assert.equal(catalogRows.length, 4);
  assert.deepEqual(
    catalogRows.flat().map((button) => button.text),
    ["🎬 Movies", "🎵 Music", "📚 Books", "🎨 Art", "✍️ Writing", "📸 Photography", "🎭 Theater", "🎧 Podcast", "🎤 Singing", "🪶 Poetry", "🖌 Painting", "🎥 Filmmaking"],
  );
});

test("age picker buttons are ordered left to right", () => {
  const visibleText = (button) => button.text.replace(/[\u2066\u2069]/g, "");
  const rangeRows = ageKeyboard("en")?.reply_markup?.inline_keyboard || [];
  assert.deepEqual(
    rangeRows[0].map(visibleText),
    ["13-17", "18-24", "25-34"],
  );
  assert.deepEqual(
    rangeRows[1].map(visibleText),
    ["35-44", "45-54", "55-64"],
  );

  const ageRows = ageRangeKeyboard("en", 13)?.reply_markup?.inline_keyboard || [];
  assert.deepEqual(
    ageRows[0].map(visibleText),
    ["13", "14", "15", "16", "17"],
  );
  assert.equal(rangeRows.at(-1)[0].callback_data, callBacks.profilePickerClose);
  assert.equal(ageRows.at(-1)[0].callback_data, callBacks.profilePickerClose);
});

test("profile age validation starts at 13", () => {
  assert.equal(isValidProfileAge(12), false);
  assert.equal(isValidProfileAge(13), true);
  assert.equal(isValidProfileAge(79), true);
  assert.equal(isValidProfileAge(80), false);
  assert.equal(isValidProfileAgeRangeStart(10), false);
  assert.equal(isValidProfileAgeRangeStart(13), true);
  assert.equal(isValidProfileAgeRangeStart(18), true);
});

test("new profiles appear in See People by default", () => {
  const user = new User({ userId: 1001 });
  assert.equal(user.showProfileInPeopleDiscovery, true);
  assert.equal(user.showActiveDiscussionOnProfile, true);
  assert.equal(user.showFavoritesOnProfile, true);
});

test("profile quick actions stay inline and privacy controls stay isolated", () => {
  const originalEconomyEnabled = starEconomy.economyEnabled;
  const originalSpendingEnabled = starEconomy.spendingEnabled;
  try {
    starEconomy.economyEnabled = true;
    starEconomy.spendingEnabled = true;
    const quick = profileQuickActionsKeyboard("en").reply_markup.inline_keyboard.flat();
    assert.deepEqual(quick.map((button) => button.callback_data), [
      callBacks.profileEditAge,
      callBacks.profileEditGender,
      callBacks.profileEditInterests,
      callBacks.profileEmoji,
      callBacks.profilePrivacy,
    ]);

    const enabledQuick = profileQuickActionsKeyboard("en", { petPreferenceEnabled: true })
      .reply_markup.inline_keyboard;
    assert.ok(enabledQuick.every((row) => row.length <= 2));
    assert.ok(enabledQuick.flat().some((button) => button.callback_data === callBacks.profileEditPetPreference));
    assert.deepEqual(enabledQuick.at(-1).map((button) => button.callback_data), [callBacks.profilePrivacy]);

    starEconomy.spendingEnabled = false;
    const disabledCallbacks = profileQuickActionsKeyboard("en").reply_markup.inline_keyboard
      .flat()
      .map((button) => button.callback_data);
    assert.equal(disabledCallbacks.includes(callBacks.profileEmoji), false);

    const unlockedCallbacks = profileQuickActionsKeyboard("en", {
      user: { profileEmojiUnlockedAt: new Date() },
    }).reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
    assert.equal(unlockedCallbacks.includes(callBacks.profileEmoji), true);
  } finally {
    starEconomy.economyEnabled = originalEconomyEnabled;
    starEconomy.spendingEnabled = originalSpendingEnabled;
  }

  const previousLocation = starEconomy.profileLocationEnabled;
  try {
    starEconomy.profileLocationEnabled = true;
    const locationRows = profileKeyboard("en", true).reply_markup.keyboard;
    const labels = locationRows.flat().map((button) => button.text);
    assert.ok(labels.includes(messages.en.profileEditLocation));
    assert.deepEqual(
      locationRows.find((row) => row.some((button) => button.text === messages.en.profileEditBio))
        .map((button) => button.text),
      [messages.en.profileEditBio, messages.en.profileEditLocation],
    );
    assert.equal(locationRows.length, 4);
    assert.ok(locationRows.every((row) => row.length <= 2));
  } finally {
    starEconomy.profileLocationEnabled = previousLocation;
  }

  const privacy = profilePrivacySafetyKeyboard("en", {
    showsActiveDiscussion: true,
    showsInPeopleDiscovery: true,
    restrictionCount: 2,
  }).reply_markup.inline_keyboard.flat();
  const privacyLabels = privacy.map((button) => button.text);
  assert.ok(!privacyLabels.includes(messages.en.profileEditLocation));
  assert.ok(privacyLabels.includes(messages.en.profileHideActiveDiscussion));
  assert.ok(privacyLabels.includes(messages.en.profileHideFavorites));
  assert.ok(privacyLabels.includes(messages.en.profileHideFromPeopleDiscovery));
  assert.ok(privacyLabels.includes(messages.en.profileInvitationRestrictionsButton));
  assert.ok(privacyLabels.includes(messages.en.accountDeleteButton));
  assert.ok(privacyLabels.includes(messages.en.profilePrivacyBackToSettings));
  assert.equal(
    privacy.find((button) => button.text === messages.en.accountDeleteButton).callback_data,
    callBacks.accountDelete,
  );
  assert.equal(profilePrivacySafetyKeyboard("en").reply_markup.keyboard, undefined);
  const visibilityRow = profilePrivacySafetyKeyboard("en", {
    showsActiveDiscussion: true,
    showsInPeopleDiscovery: true,
  }).reply_markup.inline_keyboard[0];
  assert.deepEqual(visibilityRow.map((button) => button.text), [
    messages.en.profileHideFromPeopleDiscovery,
    messages.en.profileHideActiveDiscussion,
  ]);
  assert.deepEqual(visibilityRow.map((button) => button.callback_data), [
    `${callBacks.profileSetPeopleDiscovery}0`,
    callBacks.profileToggleActiveDiscussionVisible,
  ]);
  const favoritesRow = profilePrivacySafetyKeyboard("en", {
    showsFavorites: false,
  }).reply_markup.inline_keyboard[1];
  assert.deepEqual(favoritesRow.map((button) => button.text), [messages.en.profileShowFavorites]);
  assert.deepEqual(favoritesRow.map((button) => button.callback_data), [`${callBacks.profileSetFavoritesVisible}1`]);
});

test("Pet stays hidden on profiles unless the dashboard switch is enabled", () => {
  const previous = starEconomy.profilePetPreferenceEnabled;
  const profileUser = { profileName: "Ali", petPreference: "cat" };
  try {
    starEconomy.profilePetPreferenceEnabled = false;
    assert.doesNotMatch(buildProfileText(profileUser, "en", messages), /Pet:/);
    starEconomy.profilePetPreferenceEnabled = true;
    assert.match(buildProfileText(profileUser, "en", messages), /Pet:.*Cat/);
  } finally {
    starEconomy.profilePetPreferenceEnabled = previous;
  }
});

test("Location stays hidden on profiles unless the dashboard switch is enabled", () => {
  const previous = starEconomy.profileLocationEnabled;
  const profileUser = {
    profileName: "Ali",
    location: { latitude: 35.6892, longitude: 51.389, city: "Tehran" },
  };
  try {
    starEconomy.profileLocationEnabled = false;
    assert.doesNotMatch(buildProfileText(profileUser, "en", messages), /Location:/);
    starEconomy.profileLocationEnabled = true;
    assert.match(buildProfileText(profileUser, "en", messages), /Location:.*Tehran/);
  } finally {
    starEconomy.profileLocationEnabled = previous;
  }
});

test("invitation restriction list keeps only pagination and Back inline", () => {
  const keyboard = profileInvitationRestrictionsKeyboard("en", [
    { userId: 44, name: "Taylor" },
  ], { page: 1, totalPages: 3 }).reply_markup.inline_keyboard;
  assert.equal(keyboard[0][0].callback_data, `${callBacks.profileInvitationRestrictionsPage}0`);
  assert.equal(keyboard[0][1].callback_data, `${callBacks.profileInvitationRestrictionsPage}2`);
  assert.equal(keyboard.at(-1)[0].callback_data, callBacks.profileInvitationRestrictionsClose);
  assert.equal(keyboard.at(-1)[0].text, messages.en.profileBackToSettings);
});

test("invitation restriction rows open a profile before allowing invitations again", () => {
  const view = buildInvitationRestrictionsView(messages, "en", [{
    restriction: { _id: "64f000000000000000000001", mutedUserId: 44 },
    user: { profileName: "Taylor", publicProfileCode: "u_AB12" },
  }], { totalCount: 6, start: 5 });
  assert.match(view.text, /Invitation restrictions \(6\)/);
  assert.match(view.text, /6\. 👤 Taylor/);
  assert.match(view.text, /\/restricted_u_AB12/);
  assert.doesNotMatch(view.text, /\/allow_inv_AB12/);
});

test("empty invitation restrictions point to the option on inviter profiles", () => {
  const enView = buildInvitationRestrictionsView(messages, "en", [], { totalCount: 0, start: 0 });
  const faView = buildInvitationRestrictionsView(messages, "fa", [], { totalCount: 0, start: 0 });
  assert.match(enView.text, /Open an inviter’s profile from Invitations/);
  assert.match(faView.text, /پروفایل دعوت‌کننده رو از بخش دعوت‌ها باز کن/);
});

test("canceling location sharing returns to Profile", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const previousLocationEnabled = starEconomy.profileLocationEnabled;
  let returnedUser = null;
  User.findOneAndUpdate = async () => ({});
  starEconomy.profileLocationEnabled = true;

  try {
    const ctx = {
      userId: 123,
      user: {
        userId: 123,
        lang: "en",
        firstName: "Ali",
        profileName: "Ali",
        state: "editing_location",
        showActiveDiscussionOnProfile: true,
      },
      reply: async () => ({ message_id: 1 }),
    };

    const handled = await handleProfileCancelText(ctx, "en", "editing_location", {
      sendProfile: async (_ctx, user) => { returnedUser = user; return true; },
      keyboardLang: "en",
    });

    assert.ok(handled);
    assert.equal(returnedUser.state, "idle");
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
    starEconomy.profileLocationEnabled = previousLocationEnabled;
  }
});

test("sharing a location returns to Profile", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalAxiosGet = axios.get;
  const previousLocationEnabled = starEconomy.profileLocationEnabled;
  const replies = [];
  let returnedUser = null;
  User.findOneAndUpdate = async () => ({});
  axios.get = async () => ({ data: { address: { city: "Tehran" } } });
  starEconomy.profileLocationEnabled = true;

  try {
    const ctx = {
      userId: 123,
      user: {
        userId: 123,
        lang: "en",
        firstName: "Ali",
        profileName: "Ali",
        state: "editing_location",
        showActiveDiscussionOnProfile: true,
      },
      message: { location: { latitude: 35.6892, longitude: 51.389 } },
      reply: async (text, extra) => {
        replies.push({ text, extra });
        return { message_id: replies.length };
      },
    };

    const handled = await handleProfileText(ctx, "en", "", "editing_location", {
      sendProfile: async (_ctx, user) => { returnedUser = user; return true; },
      keyboardLang: "en",
    });

    assert.ok(handled);
    assert.equal(replies[0].extra.reply_markup.remove_keyboard, true);
    assert.equal(returnedUser.state, "idle");
    assert.equal(returnedUser.location.latitude, 35.6892);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
    axios.get = originalAxiosGet;
    starEconomy.profileLocationEnabled = previousLocationEnabled;
  }
});

test("profile emoji keyboards use curated choices and explicit cost confirmation", () => {
  const previousBotEmoji = botAppearance.botEmoji;
  botAppearance.botEmoji = "🔥";
  const selectedEmoji = getProfileEmojiOptions()[0];
  const picker = profileEmojiKeyboard("en", selectedEmoji).reply_markup.inline_keyboard;
  const buttons = picker.flat();
  try {
    assert.equal(buttons.some((button) => button.text === `${selectedEmoji} ✓`), true);
    assert.equal(buttons.some((button) => button.callback_data === "profile:emoji:choose:0"), true);
    assert.equal(buttons.some((button) => button.callback_data === callBacks.profileEmojiClose), true);
    assert.equal(buttons.some((button) => button.callback_data === callBacks.profileSettings), false);
    assert.deepEqual(picker.at(-1), [{
      text: messages.en.profileEmojiCloseButton,
      callback_data: callBacks.profileEmojiClose,
    }]);
    assert.equal(buttons.filter((button) => button.callback_data?.startsWith("profile:emoji:choose:")).length, 20);
    assert.equal(buttons.some((button) => button.callback_data === "profile:emoji:page:1"), true);
    assert.equal(buttons.some((button) => button.text === "🔥"), false);
    for (const reserved of FIXED_RESERVED_EMOJIS) {
      assert.equal(buttons.some((button) => button.text === reserved), false);
    }
  } finally {
    botAppearance.botEmoji = previousBotEmoji;
  }

  const confirm = profileEmojiConfirmKeyboard("en", "abc", 3).reply_markup.inline_keyboard.flat();
  assert.match(messages.en.profileEmojiConfirmText, /activates profile emojis/);
  assert.doesNotMatch(messages.fa.profileEmojiPickerText, /هزینه|رایگان|پرداخت|دقیقاً|برای همیشه/);
  assert.equal(confirm[0].text, "Confirm — 3 Stars");
  assert.equal(confirm[0].callback_data, "profile:emoji:confirm:abc");
  assert.equal(confirm[1].text, "🔙 Back");
  assert.equal(confirm[1].callback_data, "profile:emoji:cancel");

  const freeConfirm = profileEmojiConfirmKeyboard("en", "free", 0).reply_markup.inline_keyboard.flat();
  assert.equal(freeConfirm[0].text, messages.en.profileEmojiConfirmUnlockedButton);
  assert.equal(freeConfirm[0].callback_data, "profile:emoji:confirm:free");

  const insufficient = profileEmojiInsufficientKeyboard("en").reply_markup.inline_keyboard.flat();
  assert.equal(insufficient.length, 1);
  assert.equal(insufficient[0].text, messages.en.acknowledgeButton);
  assert.equal(insufficient[0].callback_data, "profile:emoji:insufficient:done");
});

test("profile emoji typed input must be one exact allowed emoji", () => {
  const selectedEmoji = getProfileEmojiOptions()[0];
  assert.equal(getProfileEmojiIndex(selectedEmoji), 0);
  assert.equal(getProfileEmojiIndex(` ${selectedEmoji} `), 0);
  assert.equal(getProfileEmojiIndex(`${selectedEmoji} hi`), -1);
  assert.equal(getProfileEmojiIndex("⭐"), -1);
});

test("profileActiveDiscussionHelpKeyboard returns to profile", () => {
  const keyboard = profileActiveDiscussionHelpKeyboard("en");
  const buttons = (keyboard?.reply_markup?.inline_keyboard || []).flat();

  assert.deepEqual(buttons.map((button) => button.callback_data), [
    "profile:active-discussion:help:done",
  ]);
  assert.equal(buttons[0].text, messages.en.profileActiveDiscussionHelpDone);
});
