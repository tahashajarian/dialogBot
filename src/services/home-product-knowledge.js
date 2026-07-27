const CORE_PRODUCT_KNOWLEDGE = Object.freeze({
  identity: "Muze is «میوز» in Persian. Users can build their taste, see people, and join group Discussions.",
  actionBoundary: "Home explains and navigates only. All saves, edits, joins, messages, suggestions, Stars changes, payments, and confirmations stay in their existing buttons and flows.",
  truthBoundary: "Never invent current activity, unread/seen status, people, rooms, invitations, matches, or private relationships. Missing facts are unknown, not zero. Keep this rule internal; do not repeatedly say verified or confirmed to users.",
});

const PRODUCT_KNOWLEDGE_BLOCKS = Object.freeze({
  overview: Object.freeze({
    home: "Home is where users can talk naturally with Muze and open the main sections.",
    sections: "Main areas are Favorites, People, Saved Profiles, Discussions, Profile, Guide, and Stars where enabled.",
  }),
  favorites: Object.freeze({
    purpose: "Favorites records Movies & Series, Music, Books, and broad Interests to improve taste understanding and discovery.",
    lists: "Media sections can have Top 10 and save-for-later lists. Formal AI suggestions are requested only with existing Favorites buttons.",
    rules: "Suggestion eligibility, quotas, duplicates, paid fallback, taste-label rules, and Stars confirmations always remain enforced by existing flows.",
  }),
  people: Object.freeze({
    purpose: "People shows people using shared choices or taste labels, language, and enabled discovery rules. Users can open and save profiles and see visible active Discussions.",
    messaging: "People has no direct messages, friendship, or following. User-to-user conversation exists only inside joined Discussions.",
    saving: "Users can save profiles. Invitations to saved people happen from Discussions, not directly from People or Saved Profiles. Never reveal who saved whom.",
  }),
  savedProfiles: Object.freeze({
    purpose: "Saved Profiles is the user's list of people they chose to save.",
    privacy: "The saved person is not notified and cannot see the save. Saving does not create messaging, friendship, or matching.",
    actions: "Opening and removing saved profiles continue through existing buttons and confirmations.",
  }),
  discussions: Object.freeze({
    purpose: "Discussions are live group rooms and the only place users can talk with each other.",
    navigation: "Users browse rooms, invitations, their rooms, and creation controls from Discussions.",
    rules: "Joining and creation use existing eligibility, language, capacity, ownership, quota, boost, confirmation, and Stars rules. Home cannot bypass them.",
    privacy: "There is no unread or seen tracking. Never invent room activity, members, messages, invitations, or eligibility.",
  }),
  profile: Object.freeze({
    purpose: "Profile shows the user's identity and existing controls for editing, privacy, sharing, favorites visibility, and discussion visibility.",
    privacy: "People-discovery opt-out only removes new People discovery; it does not erase the profile from Saved Profiles, Discussions, invitations, or direct profile links.",
    actions: "Profile and emoji edits and privacy changes use their existing flows and confirmations.",
  }),
  guide: Object.freeze({
    purpose: "Guide explains Muze features, invitations/referrals, rules, and Stars.",
    boundary: "Muze can explain support paths but cannot pretend to perform admin or support actions.",
  }),
  stars: Object.freeze({
    purpose: "Stars are a self-only balance for selected optional extras; core Muze features remain free.",
    rules: "Rewards, spending, refunds, paid fallbacks, boosts, capacity, taste rechecks, and emoji purchases are ledger-backed and use existing confirmations.",
    boundary: "Home may explain verified self-only status but cannot spend, award, refund, or promise Stars.",
  }),
});

function getHomeProductKnowledge(topics = []) {
  const selected = {};
  for (const topic of [...new Set(topics)].slice(0, 2)) {
    if (PRODUCT_KNOWLEDGE_BLOCKS[topic]) selected[topic] = PRODUCT_KNOWLEDGE_BLOCKS[topic];
  }
  return Object.freeze({ core: CORE_PRODUCT_KNOWLEDGE, ...selected });
}

module.exports = { CORE_PRODUCT_KNOWLEDGE, PRODUCT_KNOWLEDGE_BLOCKS, getHomeProductKnowledge };
