const messages = require("../messages");
const { callBacks } = require("../constants");
const { AGE_RANGES, getProfileAgeRange } = require("./profile-age");
const { getOnboardingInterestsReplyActions, getProfileInterestsReplyActions } = require("../keyboards");
const { getSectionListLabel } = require("./ai-section");
const { getSelectableDiscussionCapacities } = require("./discussion-capacities");
const { formatCapacityOptionLabel } = require("./discussion-capacities");
const { localizeInterestChipTitleWithEmoji } = require("./interest-chips");
const { updateProfileField } = require("./users");

const MODES = Object.freeze({ GLOBAL: "global", LANGUAGE: "language", FAVORITES: "favorites", DISCUSSIONS: "discussions", PEOPLE: "people", PROFILE: "profile", PROFILE_SETTINGS: "profile_settings", HELP: "help", HELP_RULES: "help_rules" });

async function setNavigationMode(ctx, mode) {
  const normalizedMode = String(mode || "");
  if (ctx?.user) ctx.user.navigationMode = normalizedMode;
  if (!ctx?.user?._id && !ctx?.persistNavigationMode) return normalizedMode;
  await updateProfileField(ctx.userId, "navigationMode", normalizedMode);
  return normalizedMode;
}

function normalizeReplyButtonText(value) {
  return String(value || "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\uFE0F/g, "").trim().replace(/\s+/g, " ");
}

function isKnownProfileNavigationLabel(value) {
  const normalized = normalizeReplyButtonText(value);
  const keys = ["profileEditName", "profileEditAge", "profileAddPhoto", "profileEditPhoto", "profileResetPhoto", "profileEditCity", "profileEditGender", "profileEditInterests", "profileMoreSettings", "profileEditBio", "profileEditPetPreference", "profileEditLocation", "profileEmojiButton", "accountDeleteButton", "profileBackToProfile", "cancel", "cancelEdit"];
  return keys.some((key) => labels(key).includes(normalized));
}

function labels(key) {
  const localized = ["fa", "en"].map((lang) => normalizeReplyButtonText(messages[lang][key])).filter(Boolean);
  return localized.length ? localized : [normalizeReplyButtonText(key)];
}

const GLOBAL = [
  ["aiAssistant", callBacks.aiAssistant], ["discussions", callBacks.discussions],
  ["people", callBacks.people], ["mainMenuMe", callBacks.profile], ["help", callBacks.help], ["language", callBacks.language],
];
const BY_MODE = {
  [MODES.LANGUAGE]: [["🇮🇷 فارسی", callBacks.langSetFa], ["🇬🇧 English", callBacks.langSetEn], ["aiBack", callBacks.menuMain]],
  [MODES.FAVORITES]: [["aiSuggestMovies", callBacks.aiSuggestMovies], ["aiSuggestMusic", callBacks.aiSuggestMusic], ["aiSuggestBooks", callBacks.aiSuggestBooks], ["aiBack", callBacks.menuMain]],
  [MODES.DISCUSSIONS]: [["discussionActiveList", callBacks.discussionListActive], ["discussionInvitations", callBacks.discussionInvitations], ["discussionCreate", callBacks.discussionCreateStart], ["discussionMyList", callBacks.discussionListMine], ["aiBack", callBacks.menuMain]],
  [MODES.PEOPLE]: [["peopleDiscover", callBacks.peopleDiscover], ["savedProfiles", callBacks.savedProfiles], ["advancedSearchButton", callBacks.peopleAdvancedSearch], ["aiBack", callBacks.menuMain]],
  [MODES.PROFILE]: [["profileEditName", callBacks.profileEditName], ["profileEditAge", callBacks.profileEditAge], ["profileAddPhoto", callBacks.profileEditPhoto], ["profileEditPhoto", callBacks.profileEditPhoto], ["profileResetPhoto", callBacks.profileResetPhoto], ["profileEditCity", callBacks.profileEditCity], ["profileEditGender", callBacks.profileEditGender], ["profileEditInterests", callBacks.profileEditInterests], ["profileMoreSettings", callBacks.profileSettings], ["cancel", callBacks.profileBack]],
  [MODES.PROFILE_SETTINGS]: [["profileEditBio", callBacks.profileEditBio], ["profileEditPetPreference", callBacks.profileEditPetPreference], ["profileEditLocation", callBacks.profileEditLocation], ["profileShowActiveDiscussion", callBacks.profileToggleActiveDiscussionVisible], ["profileHideActiveDiscussion", callBacks.profileToggleActiveDiscussionVisible], ["profileEmojiButton", callBacks.profileEmoji], ["accountDeleteButton", callBacks.accountDelete], ["profileBackToProfile", callBacks.profileSettingsBack]],
  [MODES.HELP]: [["profileStarsButton", callBacks.profileStars], ["helpReferralButton", callBacks.helpReferral], ["helpRules", callBacks.helpRules], ["helpBackToMain", callBacks.menuMain]],
  [MODES.HELP_RULES]: [["helpBackToGuide", callBacks.help], ["helpBackToMain", callBacks.menuMain]],
  help_stars: [["profileStarsBack", callBacks.profileStarsBack]],
  people_discovery_empty: [["peopleGoToLists", callBacks.aiAssistant], ["aiBack", callBacks.people]],
};

function resolveReplyKeyboardAction(text, { mode = "", state = "idle", activeDiscussionId = null, advancedSearchEnabled = true, user = null } = {}) {
  const normalized = normalizeReplyButtonText(text);
  const lang = messages[user?.lang] ? user.lang : "fa";
  if ((state === "onboarding_language" || String(state).startsWith("onboarding_invite_language:")) && mode === "onboarding_language") {
    if (normalized === normalizeReplyButtonText("🇮🇷 فارسی")) return { callbackData: callBacks.langSetFa, key: "langSetFa" };
    if (normalized === normalizeReplyButtonText("🇬🇧 English")) return { callbackData: callBacks.langSetEn, key: "langSetEn" };
    return null;
  }
  if (state === "onboarding_welcome" && mode === "onboarding_welcome") {
    return normalized === normalizeReplyButtonText(messages[lang].onboardingStartButton)
      ? { callbackData: callBacks.onboardingStart, key: "onboardingStartButton" }
      : null;
  }
  const onboardingPickerMode = String(mode).match(/^onboarding_(?:interests|taste_interests):(\d+)$/);
  if (onboardingPickerMode && ["onboarding_interests", "onboarding_taste_setup_interests"].includes(state)) {
    const selected = user?.aiLists?.random?.topTen || [];
    for (const row of getOnboardingInterestsReplyActions(lang, selected, Number(onboardingPickerMode[1]))) {
      for (const action of row) {
        if (normalized === normalizeReplyButtonText(action.text)) return { callbackData: action.callback_data, key: "onboardingInterestAction" };
      }
    }
    return null;
  }
  const onboardingCustomMode = String(mode).match(/^onboarding_(?:custom|taste_custom):(\d+)$/);
  if (onboardingCustomMode && (String(state).startsWith("onboarding_custom_interest:") || String(state).startsWith("onboarding_taste_setup_custom_interest:"))) {
    return normalized === normalizeReplyButtonText(messages[lang].onboardingCustomCancelButton)
      ? { callbackData: `${callBacks.onboardingCustomCancel}${onboardingCustomMode[1]}`, key: "onboardingCustomCancelButton" }
      : null;
  }
  if (mode === "onboarding_taste_nudge" && state === "idle") {
    if (normalized === normalizeReplyButtonText(messages[lang].onboardingTasteSetupStartButton)) return { callbackData: callBacks.onboardingTasteSetupStart, key: "onboardingTasteSetupStartButton" };
    if (normalized === normalizeReplyButtonText(messages[lang].onboardingTasteSetupLaterButton)) return { callbackData: callBacks.onboardingTasteSetupDismiss, key: "onboardingTasteSetupLaterButton" };
    return null;
  }
  const onboardingCompleteMode = String(mode).match(/^onboarding_complete:(0|1):(0|1)$/);
  if (onboardingCompleteMode && state === "idle") {
    const actions = [];
    if (onboardingCompleteMode[2] === "1") actions.push(["onboardingDiscussionContinueButton", callBacks.onboardingDiscussionContinue]);
    if (onboardingCompleteMode[1] === "1") actions.push(["onboardingInvitationButton", callBacks.discussionInvitations]);
    actions.push(["discussionActiveList", callBacks.discussionListActive], ["onboardingFavoritesButton", callBacks.aiAssistant], ["onboardingMainMenuButton", callBacks.menuMain]);
    for (const [key, callbackData] of actions) if (normalized === normalizeReplyButtonText(messages[lang][key])) return { callbackData, key };
    return null;
  }
  const aiListMatch = String(mode).match(/^ai_list:(movies|music|books|random):(topTen|watchlist)$/);
  const aiListCompletionMatch = String(mode).match(/^ai_list_completion:(movies|music|books):topTen$/);
  const aiListFilterMatch = String(mode).match(/^ai_list_filter:(movies|music|books|random):(watched|not_watched)$/);
  const aiShareMatch = String(mode).match(/^ai_share:(movies|music|books|random):(topTen|watchlist)$/);
  const suggestionModeMatch = String(mode).match(/^ai_suggestion_mode:(movies|music|books|random)$/);
  const suggestionResultMatch = String(mode).match(/^ai_suggestion_result:(movies|music|books|random)$/);
  const suggestionNextMatch = String(mode).match(/^ai_suggestion_next:(movies|music|books|random)$/);
  const suggestionAddedMatch = String(mode).match(/^ai_suggestion_added:(movies|music|books|random)$/);
  const suggestionContextMatch = String(mode).match(/^ai_suggestion_context:(movies|music|books|random)$/);
  const discussionListMatch = String(mode).match(/^discussion_list:(active|mine):(\d+):(\d+):(all|joinable):([a-z]+)$/);
  const invitationListMatch = String(mode).match(/^discussion_invitations:(\d+):(\d+)$/);
  const discussionLanguageMatch = String(mode).match(/^discussion_language:(all|joinable):(fa|en|all)$/);
  const discussionJoinErrorMatch = String(mode).match(/^discussion_join_error:(active|mine|discussions|invitations|saved:u_[A-Z0-9]+)$/);
  const paidCapacityQuoteMatch = String(mode).match(/^discussion_create_paid_capacity:(\d+):(\d+)$/);
  const paidCapacityErrorMode = mode === "discussion_create_paid_capacity_error";
  const savedProfilesMatch = String(mode).match(/^saved_profiles:(\d+):(\d+)$/);
  const publicProfileMatch = String(mode).match(/^public_profile:(saved|people):(u_[A-Z0-9]+):(\d+):(saved|unsaved):(0|1)$/);
  const profileDiscussionsMatch = String(mode).match(/^profile_discussions:(saved|people):(u_[A-Z0-9]+):(\d+)$/);
  const profileUnsaveConfirmMatch = String(mode).match(/^profile_unsave_confirm:(list|saved|people):(u_[A-Z0-9]+):(\d+)$/);
  const peopleResultsMatch = String(mode).match(/^people_discovery_results:(\d+):(\d+)$/);
  const expectedAiState = aiListMatch
    ? `ai_manage_${aiListMatch[1]}_${aiListMatch[2] === "topTen" ? "top_ten" : "watchlist"}`
    : "";
  const validAiListState = expectedAiState && [expectedAiState, `${expectedAiState}_add_input`, `${expectedAiState}_comment_input`].includes(state);
  const validAiListCompletionState = aiListCompletionMatch && state === `ai_manage_${aiListCompletionMatch[1]}_top_ten`;
  const validAiListFilterState = aiListFilterMatch && state === `ai_manage_${aiListFilterMatch[1]}_watchlist`;
  const ageMode = mode === "profile_age" || /^profile_age_range:\d+$/.test(String(mode));
  const profilePickerState = (mode === "profile_gender" && state === "editing_gender") || (mode === "profile_pet" && state === "editing_pet_preference");
  const profileEmojiSettingsState = mode === MODES.PROFILE_SETTINGS && state === "editing_profile_emoji";
  const interestMode = String(mode).match(/^profile_interests:(\d+)$/);
  const validAiShareState = aiShareMatch && state === `ai_manage_${aiShareMatch[1]}_${aiShareMatch[2] === "topTen" ? "top_ten" : "watchlist"}`;
  const validSuggestionModeState = suggestionModeMatch && [
    `ai_chat_${suggestionModeMatch[1]}`,
    `ai_suggest_context_${suggestionModeMatch[1]}`,
  ].includes(state);
  const validSuggestionResultState = suggestionResultMatch && state === `ai_chat_${suggestionResultMatch[1]}`;
  const validSuggestionNextState = suggestionNextMatch && state === `ai_chat_${suggestionNextMatch[1]}`;
  const validSuggestionAddedState = suggestionAddedMatch && state === `ai_chat_${suggestionAddedMatch[1]}`;
  const validSuggestionContextState = suggestionContextMatch && state === `ai_suggest_context_${suggestionContextMatch[1]}`;
  const activeRoomNavigationAllowed = mode === MODES.DISCUSSIONS
    || discussionListMatch
    || invitationListMatch
    || discussionLanguageMatch
    || discussionJoinErrorMatch
    || savedProfilesMatch
    || publicProfileMatch
    || profileDiscussionsMatch
    || profileUnsaveConfirmMatch
    || peopleResultsMatch
    || String(state).startsWith("discussion_create_");
  if ((state !== "idle" && !String(state).startsWith("discussion_create_") && !validAiListState && !validAiListCompletionState && !validAiListFilterState && !validAiShareState && !validSuggestionModeState && !validSuggestionResultState && !validSuggestionNextState && !validSuggestionAddedState && !validSuggestionContextState && !(ageMode && state === "editing_age") && !profilePickerState && !profileEmojiSettingsState && !(interestMode && state === "editing_interests")) || (activeDiscussionId && !activeRoomNavigationAllowed)) return null;
  const entries = [...(mode === MODES.GLOBAL ? GLOBAL : []), ...(BY_MODE[mode] || [])];
  if (discussionListMatch && state === "idle") {
    const [, type, pageRaw, pagesRaw, filter, language] = discussionListMatch;
    const page = Number(pageRaw); const pages = Number(pagesRaw);
    const prefix = type === "mine" ? callBacks.discussionListMinePage : callBacks.discussionListActivePage;
    const suffix = type === "active" ? `:${filter}:${language}` : "";
    if (page < pages - 1) entries.push([`${messages[user?.lang || "fa"].discussionListMorePage} ➡️`, `${prefix}${page + 1}${suffix}`]);
    if (page > 0) entries.push([`⬅️ ${messages[user?.lang || "fa"].discussionListPrevPage}`, `${prefix}${page - 1}${suffix}`]);
    if (type === "active") {
      entries.push([`🔓 ${filter === "joinable" ? messages[user?.lang || "fa"].discussionListShowAll : messages[user?.lang || "fa"].discussionListOnlyJoinable}`, `${callBacks.discussionListActivePage}0:${filter === "joinable" ? "all" : "joinable"}:${language}`]);
      const lang = user?.lang || "fa";
      const languageLabel = language === "all" ? messages[lang].discussionLanguageBoth : language === "en" ? messages[lang].discussionLanguageEnglish : messages[lang].discussionLanguagePersian;
      entries.push([messages[lang].discussionChangeLanguage.replace("{language}", languageLabel), `${callBacks.discussionListLanguageOpen}${filter}:${language}`]);
    }
    entries.push(["discussionBack", callBacks.discussions]);
  }
  if (invitationListMatch && state === "idle") {
    const page = Number(invitationListMatch[1]); const pages = Number(invitationListMatch[2]);
    if (page < pages - 1) entries.push([`${messages[user?.lang || "fa"].discussionListMorePage} ➡️`, `${callBacks.discussionInvitationsPage}${page + 1}`]);
    if (page > 0) entries.push([`⬅️ ${messages[user?.lang || "fa"].discussionListPrevPage}`, `${callBacks.discussionInvitationsPage}${page - 1}`]);
    entries.push(["discussionBack", callBacks.discussions]);
  }
  if (discussionLanguageMatch && state === "idle") {
    const joinability = discussionLanguageMatch[1]; const current = discussionLanguageMatch[2]; const lang = user?.lang || "fa";
    for (const [value, flag, key] of [["fa", "🇮🇷", "discussionLanguagePersian"], ["en", "🇬🇧", "discussionLanguageEnglish"], ["all", "🌐", "discussionLanguageBoth"]]) {
      entries.push([`${value === current ? "✓ " : ""}${flag} ${messages[lang][key]}`, `${callBacks.discussionListLanguageSet}${joinability}:${value}`]);
    }
    entries.push(["discussionBack", `${callBacks.discussionListActivePage}0:${joinability}:${current}`]);
  }
  if (discussionJoinErrorMatch && state === "idle") entries.push(["acknowledgeButton", `${callBacks.discussionJoinErrorAck}${discussionJoinErrorMatch[1]}`]);
  if (savedProfilesMatch && state === "idle") {
    const page = Number(savedProfilesMatch[1]);
    const pages = Number(savedProfilesMatch[2]);
    if (page < pages - 1) entries.push([`${messages[user?.lang || "fa"].discussionListMorePage} ➡️`, `${callBacks.savedProfilesPage}${page + 1}`]);
    if (page > 0) entries.push([`🔙 ${messages[user?.lang || "fa"].discussionListPrevPage}`, `${callBacks.savedProfilesPage}${page - 1}`]);
    entries.push(["aiBack", callBacks.people]);
  }
  if (publicProfileMatch && state === "idle") {
    const [, source, code, pageRaw, savedState, discussionsRaw] = publicProfileMatch;
    const page = Number(pageRaw);
    if (savedState === "saved" && discussionsRaw === "1") {
      entries.push(["savedProfileDiscussions", `${callBacks.savedProfilesDiscussions}${source === "saved" ? "saved" : "browse"}:${code}`]);
    }
    entries.push([
      savedState === "saved" ? "savedProfileRemove" : "profileSaveButton",
      `${savedState === "saved" ? callBacks.profileUnsaveByCode : callBacks.profileSaveByCode}${code}`,
    ]);
    entries.push([
      source === "saved" ? "profileBackToSaved" : "aiBack",
      source === "saved" ? `${callBacks.savedProfilesPage}${page}` : `${callBacks.peopleDiscoverPage}${page}`,
    ]);
  }
  if (profileDiscussionsMatch && state === "idle") {
    entries.push(["aiBack", `${callBacks.profileViewByCode}${profileDiscussionsMatch[2]}`]);
  }
  if (profileUnsaveConfirmMatch && state === "idle") {
    entries.push(
      ["savedProfileRemoveConfirmButton", callBacks.profileUnsaveConfirm],
      ["savedProfileRemoveCancelButton", callBacks.profileUnsaveCancel],
    );
  }
  if (peopleResultsMatch && state === "idle") {
    const page = Number(peopleResultsMatch[1]);
    const pages = Number(peopleResultsMatch[2]);
    if (page < pages - 1) entries.push([`${messages[user?.lang || "fa"].discussionListMorePage} ➡️`, `${callBacks.peopleDiscoverPage}${page + 1}`]);
    if (page > 0) entries.push([`🔙 ${messages[user?.lang || "fa"].discussionListPrevPage}`, `${callBacks.peopleDiscoverPage}${page - 1}`]);
    entries.push(["aiBack", callBacks.people]);
  }
  if (String(state).startsWith("discussion_create_")) {
    if (paidCapacityQuoteMatch) {
      const capacity = Number(paidCapacityQuoteMatch[1]);
      const cost = Number(paidCapacityQuoteMatch[2]);
      const formattedCost = require("./stars-ui").formatStarNumber(cost, user?.lang || "fa");
      entries.push(
        [messages[user?.lang || "fa"].discussionPaidCapacityConfirmButton.replace("{cost}", formattedCost), `${callBacks.discussionCreatePaidCapacityConfirm}${capacity}:${cost}`],
        ["discussionPaidCapacityCancelButton", callBacks.discussionCreatePaidCapacityCancel],
      );
    } else if (paidCapacityErrorMode) {
      entries.push(
        ["discussionEditCapacity", callBacks.discussionCreateEditCapacity],
        ["discussionBack", callBacks.discussionCreatePaidCapacityAck],
      );
    } else {
    const isEditState = state.endsWith("_edit") || mode === "discussion_create_capacity";
    entries.push(
      [isEditState ? "discussionCancelEdit" : "discussionCreateCancel", isEditState ? callBacks.discussionCreateCancelEdit : callBacks.discussionCreateCancel],
      ["discussionBack", state === "discussion_create_join_rule" ? callBacks.discussionCreateBackToTitle : callBacks.discussionCreatePreview],
    );
    if (state.includes("description")) entries.push(["discussionSkipDescription", callBacks.discussionCreateSkipDescription]);
    if (state.includes("join_rule")) entries.push(["discussionJoinRuleOpen", callBacks.discussionCreateRuleOpen], ["discussionJoinRuleTaste", callBacks.discussionCreateRuleTaste], ["discussionJoinRuleItem", callBacks.discussionCreateRuleItem]);
    if (state === "discussion_create_preview") {
      const lang = user?.lang || "fa";
      const draftLanguage = user?.discussionDraftLanguage === "en" ? "en" : "fa";
      const languageLabel = draftLanguage === "en" ? messages[lang].discussionLanguageEnglish : messages[lang].discussionLanguagePersian;
      entries.push(["discussionCreateConfirm", callBacks.discussionCreateConfirm], ["discussionEditTitle", callBacks.discussionCreateEditTitle], ["discussionEditDescription", callBacks.discussionCreateEditDescription], ["discussionEditRule", callBacks.discussionCreateEditRule], ["discussionEditCapacity", callBacks.discussionCreateEditCapacity], [messages[lang].discussionChangeLanguage.replace("{language}", languageLabel), callBacks.discussionCreateToggleLanguage]);
    }
    if (mode === "discussion_create_language") entries.push([`🇮🇷 ${messages[user?.lang || "fa"].discussionLanguagePersian}`, `${callBacks.discussionCreateSetLanguage}fa`], [`✓ 🇮🇷 ${messages[user?.lang || "fa"].discussionLanguagePersian}`, `${callBacks.discussionCreateSetLanguage}fa`], [`🇬🇧 ${messages[user?.lang || "fa"].discussionLanguageEnglish}`, `${callBacks.discussionCreateSetLanguage}en`], [`✓ 🇬🇧 ${messages[user?.lang || "fa"].discussionLanguageEnglish}`, `${callBacks.discussionCreateSetLanguage}en`], ["discussionBack", callBacks.discussionCreateLanguageBack]);
    if (mode === "discussion_create_capacity") for (const capacity of getSelectableDiscussionCapacities()) entries.push([formatCapacityOptionLabel(capacity, user?.lang || "fa"), `${callBacks.discussionCreateSetCapacity}${capacity}`], [`✅ ${formatCapacityOptionLabel(capacity, user?.lang || "fa")}`, `${callBacks.discussionCreateSetCapacity}${capacity}`]);
    if (mode === "discussion_create_section") entries.push(["aiSuggestMovies", `${callBacks.discussionCreateRuleSection}movies`], ["aiSuggestMusic", `${callBacks.discussionCreateRuleSection}music`], ["aiSuggestBooks", `${callBacks.discussionCreateRuleSection}books`], ["aiSuggestRandom", `${callBacks.discussionCreateRuleSection}random`], ["discussionBack", callBacks.discussionCreateBackToJoinRule]);
    const tasteMode = String(mode).match(/^discussion_create_taste:(movies|music|books|random):(.+)$/);
    if (tasteMode) {
      const section = tasteMode[1]; const labelKey = tasteMode[2];
      const { getTasteLabelEmoji, getTasteLabelTitle } = require("./ai-section");
      entries.push([`${getTasteLabelEmoji(section, labelKey)} ${getTasteLabelTitle(messages, user?.lang || "fa", section, labelKey)}`, `${callBacks.discussionCreateSelectTaste}${section}:${labelKey}`], ["discussionBack", callBacks.discussionCreateBackToSection]);
    }
    const itemMode = String(mode).match(/^discussion_create_item:(movies|music|books|random)$/);
    if (itemMode) {
      const section = itemMode[1]; const items = user?.aiLists?.[section]?.topTen || [];
      items.slice(0, 10).forEach((entry, index) => entries.push([section === "random" ? localizeInterestChipTitleWithEmoji(entry.title, user?.lang || "fa") : entry.title, `${callBacks.discussionCreateSelectItem}${section}:${index}`]));
      entries.push(["discussionBack", callBacks.discussionCreateBackToSection]);
    }
    }
  }
  if (aiListFilterMatch) entries.push(["aiListManageShowAll", `${callBacks.aiListManageShow}${aiListFilterMatch[1]}:watchlist:all`]);
  if (aiShareMatch) {
    const [, section, listType] = aiShareMatch;
    entries.push(["aiListShareBackToList", `${callBacks.aiListShareBack}${section}:${listType === "topTen" ? "top_ten" : "watchlist"}`]);
  }
  if (suggestionModeMatch) {
    const section = suggestionModeMatch[1];
    entries.push(["aiSuggestionFromTopTenButton", `${callBacks.aiSectionSuggestFromTopTen}${section}`], ["aiBack", `${callBacks.aiListManageMenu}${section}:top_ten`]);
  }
  if (suggestionResultMatch) {
    const section = suggestionResultMatch[1];
    const lang = messages[user?.lang] ? user.lang : "fa";
    const addText = messages[lang].aiSuggestionAddToListButton.replace("{listName}", getSectionListLabel(messages, lang, section));
    entries.push([addText, `${callBacks.aiSectionAddSuggestion}${section}`]);
    const doneKey = section === "music" ? "aiSuggestionAddDoneButtonMusic" : section === "books" ? "aiSuggestionAddDoneButtonBooks" : section === "random" ? "aiSuggestionAddDoneButtonRandom" : "aiSuggestionAddDoneButtonMovies";
    entries.push([doneKey, `${callBacks.aiSectionAddSuggestionDone}${section}`], ["aiSuggestionRejectButton", `${callBacks.aiSectionRejectSuggestion}${section}`]);
  }
  if (suggestionNextMatch) {
    const section = suggestionNextMatch[1];
    entries.push(["aiSuggestionAnotherButton", `${callBacks.aiSectionAnotherSuggestion}${section}`], ["aiSuggestionGoToFavoritesButton", `${callBacks.aiListManageMenu}${section}:top_ten`]);
  }
  if (suggestionAddedMatch) {
    const section = suggestionAddedMatch[1];
    entries.push(["aiSuggestionAnotherButton", `${callBacks.aiSectionAnotherSuggestion}${section}`]);
    for (const lang of [user?.lang].filter((value) => messages[value])) {
      const listText = messages[lang].aiSuggestionGoToListButton.replace("{listName}", getSectionListLabel(messages, lang, section));
      entries.push([listText, `${callBacks.aiListManageShow}${section}:watchlist`]);
    }
    entries.push(["aiSuggestionGoToFavoritesButton", `${callBacks.aiListManageMenu}${section}:top_ten`]);
  }
  if (suggestionContextMatch) entries.push(["cancelEdit", `${callBacks.aiSectionSuggestContextCancel}${suggestionContextMatch[1]}`]);
  if (mode === "profile_age") {
    for (const [start, end] of AGE_RANGES) {
      entries.push([`${start}-${end}`, `${callBacks.profileAgeRangeSet}${start}`]);
    }
    entries.push(["cancelEdit", callBacks.profileCancelEdit]);
  }
  const ageRangeMatch = String(mode).match(/^profile_age_range:(\d+)$/);
  if (ageRangeMatch) {
    const start = Number(ageRangeMatch[1]);
    const [, end] = getProfileAgeRange(start);
    for (let age = start; age <= end; age += 1) entries.push([String(age), `${callBacks.profileAgeSet}${age}`]);
    entries.push(["🔙", callBacks.profileAgeRangeBack], ["cancelEdit", callBacks.profileCancelEdit]);
  }
  if (mode === "profile_gender") entries.push(["genderOptionFemaleButton", `${callBacks.profileGenderSet}female`], ["genderOptionMaleButton", `${callBacks.profileGenderSet}male`], ["genderOptionOtherButton", `${callBacks.profileGenderSet}other`], ["cancelEdit", callBacks.profileCancelEdit]);
  if (mode === "profile_pet") entries.push(["petOptionAnyButton", `${callBacks.profilePetSet}any`], ["petOptionNoneButton", `${callBacks.profilePetSet}none`], ["petOptionCatButton", `${callBacks.profilePetSet}cat`], ["petOptionDogButton", `${callBacks.profilePetSet}dog`], ["petOptionBirdButton", `${callBacks.profilePetSet}bird`], ["petOptionSmallPetsButton", `${callBacks.profilePetSet}small_pets`], ["cancelEdit", callBacks.profileCancelEdit]);
  if (interestMode) {
    const selected = user?.aiLists?.random?.topTen || [];
    for (const row of getProfileInterestsReplyActions(user?.lang || "fa", selected, Number(interestMode[1]))) {
      for (const action of row) entries.push([action.text, action.callback_data]);
    }
  }
  if (aiListMatch) {
    const [, section, listType] = aiListMatch;
    const token = listType === "watchlist" ? "watchlist" : "top_ten";
    if (state === `${expectedAiState}_add_input`) {
      entries.push(["cancelEdit", `${callBacks.aiListManageCancelAdd}${section}:${token}`]);
      entries.push(["aiListManageAddBackToList", `${callBacks.aiListManageCancelAdd}${section}:${token}:back`]);
    }
    if (state === `${expectedAiState}_comment_input`) entries.push(["cancelEdit", `${callBacks.aiListManageCancelComment}${section}:${token}`]);
    const addKeys = listType === "watchlist"
      ? [section === "movies" ? "aiListManageAddLaterMovies" : section === "music" ? "aiListManageAddLaterMusic" : "aiListManageAddLaterBooks"]
      : [section === "movies" ? "aiFavoritesAddFirstMovies" : section === "music" ? "aiFavoritesAddFirstMusic" : "aiFavoritesAddFirstBooks",
        section === "movies" ? "aiFavoritesAddAnotherMovies" : section === "music" ? "aiFavoritesAddAnotherMusic" : "aiFavoritesAddAnotherBooks"];
    if (state === expectedAiState) for (const key of addKeys) entries.push([key, `${callBacks.aiListManageAdd}${section}:${token}`]);
    if (state === expectedAiState && listType === "topTen" && section !== "random") {
      entries.push([section === "movies" ? "aiSectionListButtonMovies" : section === "music" ? "aiSectionListButtonMusic" : "aiSectionListButtonBooks", `${callBacks.aiListManageMenu}${section}:watchlist`]);
      entries.push(["aiSectionSuggestButton", `${callBacks.aiSectionSuggestMenu}${section}`]);
      entries.push(["aiListManageShare", `${callBacks.aiListManageShare}${section}:${token}`]);
    }
    if (state === expectedAiState && listType === "watchlist") {
      const status = section === "music" ? ["aiListManageShowWatchedMusic", "aiListManageShowNotWatchedMusic"] : section === "books" ? ["aiListManageShowWatchedBooks", "aiListManageShowNotWatchedBooks"] : ["aiListManageShowWatchedMovies", "aiListManageShowNotWatchedMovies"];
      entries.push([status[0], `${callBacks.aiListManageShow}${section}:${token}:watched`], [status[1], `${callBacks.aiListManageShow}${section}:${token}:not_watched`], ["aiSuggestionGoToFavoritesButton", `${callBacks.aiListManageBack}${section}`]);
    } else if (state === expectedAiState) entries.push(["aiBack", `${callBacks.aiListManageBack}${section}`]);
  }
  if (validAiListCompletionState) {
    entries.push(["aiListManageAddBackToList", `${callBacks.aiListManageCancelAdd}${aiListCompletionMatch[1]}:top_ten:back`]);
  }
  for (const [key, callbackData] of entries) {
    if (key === "advancedSearchButton" && !advancedSearchEnabled) continue;
    const currentLang = messages[user?.lang] ? user.lang : "";
    const localizedValue = currentLang ? normalizeReplyButtonText(messages[currentLang][key]) : "";
    const variants = localizedValue ? [localizedValue] : labels(key);
    const templated = variants.some((label) => label.includes("{count}") || label.includes("{goal}"))
      && variants.some((label) => {
        const pattern = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{count\\\}|\\\{goal\\\}/g, "[0-9۰-۹]+");
        return new RegExp(`^${pattern}$`).test(normalized);
      });
    if (variants.includes(normalized) || templated) return { callbackData, key, global: GLOBAL.some(([candidate]) => candidate === key) };
  }
  return null;
}

module.exports = { MODES, isKnownProfileNavigationLabel, normalizeReplyButtonText, resolveReplyKeyboardAction, setNavigationMode };
