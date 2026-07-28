# Conversational Home

## Status

The Conversational Home implementation is complete, but release verification remains pending until the full dependency-backed test suite passes. It uses a focused Home flow, an on-demand verified snapshot, topic-selected application-owned product knowledge, constrained AI response, application-owned destination allowlist, rendering, a visible Telegram typing state, and a short runtime-only conversation window. The runtime window expires automatically, is capped by user count with oldest-entry eviction, and is never persisted as durable conversation history.

Eligible users whose durable navigation mode is Home can start a natural conversation. Unrecognized text in other idle section hubs receives one low-noise instruction to use the available buttons. Text in onboarding, temporary input flows, and active discussion rooms keeps its existing scoped behavior.

## Token And Context Budget

Home does not send the full product manual or full user snapshot on every request. A deterministic local router selects at most two concise product-knowledge blocks and identifies the exact verified fields required for the current message. Casual conversation performs no invitation or discussion database reads. Exact invitation-count questions use a local truthful response and spend no AI tokens.

The AI request includes only:

- a small permanent identity, voice, truth, and action-boundary prompt;
- the current user message;
- at most four short runtime-only conversation turns;
- only requested verified snapshot fields;
- the core product contract plus at most two relevant section blocks.

Normal output is capped at 140 tokens. These limits reduce cost without weakening feature accuracy because every implemented section remains available through topic-selected knowledge. Unknown or ambiguous product capabilities must still be treated as unavailable rather than invented.

## Product Purpose

Home should feel like the living center of Muze without becoming another dashboard, activity feed, or menu.

The first version does this through conversation:

- An onboarded user can type ordinary text while in Home and talk directly with Muze.
- Muze answers naturally and respectfully in first person.
- Muze can explain what is currently happening around the user using verified product data.
- Muze can suggest where to continue or explain where an existing capability lives.
- When an existing safe destination action is easy to reuse, the response may include one relevant button.

The user should feel that Muze understands their current place and continues becoming more useful over time. The experience must not imply that Muze is a checklist that can be permanently finished, and it must not manufacture activity to avoid a quiet answer.

## Agreed MVP

The MVP is conversational Home only.

It does not include:

- a permanent or automatically generated Home status card;
- a Refresh button;
- unread or seen-message tracking;
- a chronological activity feed;
- proactive Home notifications;
- automatic background refresh;
- a new Home submenu;
- durable free-form conversation history;
- automatic mutations inferred from conversation.

The conversation itself is the refresh mechanism. When the user asks «چه خبر؟» or “What’s new?”, Muze checks unseen pending invitations and otherwise gives a quiet truthful response. It does not call recently created people or Discussions “new” without user-specific seen-state tracking. Broader status and next-step questions use their own verified snapshot plans.

A status card and Refresh control may be reconsidered later. They should reuse the same snapshot service rather than introduce a second source of truth.

## Entry And Discoverability

The normal Home message should teach the capability compactly:

Persian:

> 🏠 خانه
>
> 👩‍🦳 یکی از گزینه‌ها رو انتخاب کن یا همین‌جا با من حرف بزن.

English:

> 🏠 Home
>
> 👩‍🦳 Choose an option, or talk to me here.

Do not repeat a long product explanation whenever the user returns Home. `/start` for an already-onboarded user keeps its existing clean Home behavior and may use the same compact capability hint.

The existing persistent reply keyboard remains the stable navigation layer. Conversation adds a natural entry point to existing features; it does not replace their buttons or structured flows.

## Eligibility And Routing

Free-form Home conversation is eligible only when all of these are true:

- onboarding is complete;
- the user account is active and allowed to use the bot;
- persisted user state is `idle`;
- persisted reply-keyboard navigation mode is the global Home mode;
- the user is not active inside a discussion;
- the update contains ordinary supported text;
- the text is not a recognized global command, deep link, or structured command;
- the text is not an authorized Home reply-keyboard label;
- the text is not a delayed label from a stale reply keyboard.

Routing order must remain deterministic:

1. Apply outer access, ban, rate-limit, and runtime-health checks.
2. Resolve global commands and deep links.
3. Resolve server-authorized reply-keyboard actions.
4. Route active discussion content and temporary input states to their existing handlers.
5. Route eligible ordinary Home text to the Home conversation flow.
6. In every other idle navigation mode, send one short localized instruction to use the available buttons. Do not intercept active discussion messages or temporary input flows.

Stale bottom labels must not become AI prompts. Label recognition remains centralized in `src/services/reply-keyboard-navigation.js`, including localized and legacy variants. A user must not be charged for or receive a conversational response to a delayed keyboard tap.

Home conversation must not be available merely because Telegram still displays the Home keyboard. Persisted server-side mode remains the authority.

## What Users Can Ask

The flow should handle both product-aware questions and ordinary human conversation.

Common product-aware intentions include:

- «چه خبر؟» / “What’s happening?”
- «چیزی منتظرمه؟» / “Is anything waiting for me?”
- «دعوتی دارم؟» / “Do I have invitations?”
- «بحثم چه وضعیه؟» / “What’s happening in my discussion?”
- «الان چیکار کنم؟» / “What should I do next?”
- «محبوب‌هام کجان؟» / “Where are my favorites?”
- «چطور پروفایلم رو تغییر بدم؟» / “How do I change my profile?”
- questions about Stars, People, Saved Profiles, Favorites, suggestions, discussions, invitations, privacy, or other implemented Muze capabilities.

Ordinary conversation may include:

- greetings;
- comments about something the user watched, heard, read, or discovered;
- “I’m bored” or a request for a direction;
- questions about what Muze understands from the user’s choices;
- general conversational questions.

Muze may answer directly, ask one focused follow-up question, or connect the thought to an existing Muze capability when that connection is genuinely useful. It should not force every ordinary message into a product action.

## Verified Home Snapshot

The language model must not discover product state by guessing, constructing database queries, or interpreting a raw User document. Application code builds a compact, typed, read-only snapshot before generating a product-aware response.

The model also receives an application-owned, read-only product capability contract. This contract is the authority for feature questions and navigation facts. It explicitly records current boundaries such as: People has no direct messaging; user-to-user conversation happens only inside Discussions; Saved Profiles are private bookmarks; Discussions have no unread tracking; and all mutations stay in existing structured flows. The model must say it is unsure rather than invent a capability outside this contract.

The snapshot may contain only facts needed for the response, such as:

### User context

- interface language;
- safe display name, when available;
- broad profile Interests;
- compact counts or titles from the user’s own Favorites when relevant;
- completed or currently available suggestion/taste milestones;
- incomplete profile areas only when they produce a useful, non-repetitive direction.

### Current activity

- whether the user is currently associated with an open active discussion;
- the discussion’s safe localized title;
- its last activity time or a coarse recent-activity state;
- waiting invitation count and a safe summary of the most relevant invitation;
- recent activity in open discussions created by the user;
- recent owner join notifications or member changes only when the underlying product data supports the claim.

### Available directions

- whether an existing suggestion can be requested;
- a Favorites section near a meaningful threshold;
- eligible relevant active discussions;
- implemented profile, People, Saved Profiles, Stars, Guide, or Discussions destinations;
- one preferred next step selected from verified candidates.

### Recent presentation context

If implemented later, a bounded record of recent Home recommendations may be included to avoid repeating the same non-urgent suggestion. The MVP does not require durable conversational memory.

Do not include:

- secrets, API keys, internal identifiers, raw callback payloads, or database metadata;
- private saved-profile relationships in a way that implies the other person knows;
- other users’ hidden fields;
- full recent discussion-message content unless a separately reviewed product and privacy rule explicitly allows it;
- raw moderation, report, ledger, or operational records;
- irrelevant parts of the User document.

## Truthfulness Rules

Muze must distinguish verified product facts from interpretation.

- Never call messages “unread” or give an unread count. Discussions intentionally have no seen/read count in the current product.
- Prefer “recently active” or a factual last-activity description.
- Never say that someone “similar to you joined” unless an implemented, privacy-safe matching rule supports that exact claim.
- A new member joining a discussion may be mentioned only when the user is entitled to that event and the underlying join data is available.
- Never imply that another user intentionally sought out, followed, saved, or liked the current user unless the product records and exposes that action.
- Never expose that someone saved the user; Saved Profiles are private one-way bookmarks.
- Never invent invitations, activity, suggestions, matches, milestones, urgency, or social proof.
- When no relevant activity exists, say so calmly and offer an optional direction.
- If snapshot data is partial or temporarily unavailable, answer only from available facts or explain that the current status could not be checked.

Acceptable quiet-state meaning:

> فعلا چیزی منتظر توجهت نیست. اگر دوست داشته باشی، می‌تونیم یه مسیر تازه پیدا کنیم.

Avoid language that implies either permanent completion or fabricated movement:

- “You have finished everything.”
- “Everyone missed you.”
- “People are waiting for you.”
- “There is always something urgent.”

## Ongoing Value, Not Endless Completion

Muze should communicate that taste and social context can develop over time:

- Favorites can be revisited as taste changes.
- More choices can improve suggestions and relevance.
- New discussions and invitations may appear.
- Existing choices can reveal new connections.
- Quiet moments can lead to optional exploration.

Do not use manipulative incompleteness:

- no global completion percentage;
- no artificial streak or urgency;
- no repeated nagging about the same profile field;
- no implication that the user must keep adding data for Muze to be worthwhile.

The intended feeling is:

> Muze is already useful, and it can become more personal over time.

Not:

> I must keep completing Muze.

## Response Style

Conversational responses must use the product name exactly as `Muze` in English and «میوز» in Persian. Never write «موزه». Every bot-authored Home conversation reply starts with the configured Muze marker emoji. The model is instructed to include the default marker, and application rendering enforces it so dashboard-configured marker replacement still applies.

Muze’s conversational replies should:

- use first person when Muze speaks personally;
- address the user informally and respectfully;
- follow the narrative voice and Persian writing rules in `docs/bot-ux.md`;
- default to one to three short paragraphs;
- lead with the answer rather than a feature explanation;
- mention no more than the few facts necessary to answer the question;
- recommend at most one next step by default;
- ask no more than one focused follow-up question at a time;
- avoid repeated greetings, product introductions, and “welcome back” copy;
- avoid long general-AI essays unless the user clearly asks for detail;
- remain honest when nothing needs attention;
- avoid excessive celebration, pressure, or artificial intimacy.

Examples:

User:

> چه خبر؟

Muze:

> 👩‍🦳 یک دعوت منتظرته و گفت‌وگوت هم اخیرا فعال بوده. پیشنهاد می‌کنم اول دعوتت رو ببینی.

User:

> الان چیکار کنم؟

Muze:

> 👩‍🦳 با سه فیلم دیگه، محبوب‌های سینمایی‌ات کامل‌تر می‌شن و می‌تونم سلیقه‌ات رو دقیق‌تر بررسی کنم.

User:

> حوصله‌م سر رفته

Muze:

> 👩‍🦳 بیا یه مسیر پیدا کنیم. الان بیشتر حوصله‌ی کشف یه چیز تازه رو داری یا حرف‌زدن با آدم‌ها؟

English and Persian must preserve the same speaker and product meaning rather than translating word for word.

## Action Policy

Conversation helps users reach existing capabilities. It is not a second mutation layer.

For the MVP:

- If an existing, safe destination callback can be reused without new durable context, attach at most one relevant button.
- If adding a button would require new stateful callback machinery, explain the shortest path through the visible reply keyboard.
- Prefer a clear destination button over a textual path when both are equally safe and easy.
- Do not duplicate the whole Home keyboard as inline actions.
- A focused follow-up question may use two mutually exclusive choice buttons when necessary.

Examples:

- Waiting invitation → existing Invitations destination button.
- Active discussion → existing safe room-return action when available.
- Continue Favorites → existing Favorites or section destination when safely reusable.
- Complex profile setting → explain `Me → Settings` if no safe direct destination exists.

Every mutation remains behind the existing structured flow and confirmation rules:

- adding or removing a Favorite;
- changing profile data or privacy;
- joining, leaving, closing, or creating a discussion;
- sending an invitation;
- saving or removing a profile;
- spending Stars;
- deleting an account.

If a user says “I love Interstellar,” Muze may ask whether it belongs in Favorites, but must not add it automatically. Any proposed action must preserve existing validation, quotas, stale-state checks, idempotency, and confirmation behavior.

## Relationship To Existing AI Features

Home conversation is an orchestration and guidance surface, not a replacement for Favorites suggestions.

- Requests for an implemented recommendation should enter or point to the existing section-scoped suggestion flow.
- Existing minimum-Favorites requirements, quotas, paid fallback, Star confirmation, refunds, duplicate rules, and result controls remain authoritative.
- Home conversation must not provide unlimited substitute recommendations that bypass those rules.
- AI suggestions must continue to originate from their structured section action. Free-form text inside a Favorites/AI section still follows that section’s documented behavior and must not silently become Home conversation.
- Home may answer general discussion about a movie, song, book, or interest, but saving and formal recommendation actions use existing flows.

## Low-Noise And Message Lifecycle

- Each user message may receive one concise Muze response.
- Send Telegram’s `typing` chat action immediately while Home context and the AI response are being prepared. Refresh it quietly during longer requests, stop it before or immediately after the final reply, and never send a separate placeholder message.
- Do not delete user messages.
- Do not create or track a permanent Home conversation card in the MVP.
- Contextual action controls belong to the individual response and must be revalidated when used.
- Returning Home sends the existing compact Home surface; it does not summarize or replay the prior conversation.
- Conversation history remains ordinary Telegram chat history. The MVP does not persist a separate transcript.
- Avoid sending both a textual navigation explanation and an equivalent button unless the explanation adds necessary context.

## Safety, Privacy, And Prompt Boundaries

- Treat user text as untrusted input.
- The model may choose wording and a constrained response intent; it must not construct arbitrary callback data or authorize operations.
- Map any model-selected destination through a fixed application allowlist.
- Render button labels and callback payloads from application-owned definitions.
- Never expose system prompts, snapshot internals, hidden policies, or raw user records.
- Do not let user instructions override privacy rules, Star rules, discussion conditions, confirmation requirements, or data visibility.
- Apply existing content-safety and moderation boundaries to generated replies.
- Log operational metadata without storing sensitive message content unless the project adopts a separately documented retention policy.
- Analytics should prefer event categories such as `home_conversation_started`, `home_status_asked`, `home_destination_offered`, and `home_conversation_failed`; do not log the user’s raw text or generated reply by default.

## Failure Behavior

If verified status data cannot be loaded:

> 👩‍🦳 الان نتونستم وضعیتت رو بررسی کنم. می‌تونی از دکمه‌های پایین استفاده کنی یا کمی بعد دوباره ازم بپرسی.

If the AI provider fails:

- preserve Home mode and its reply keyboard;
- do not change user data;
- send one compact localized failure response;
- do not present guessed status;
- allow the user to retry naturally.

If a destination becomes stale between response and button tap, the existing destination flow must revalidate current state and show its normal safe result.

## Suggested Code Boundaries

Implementation should keep `src/bot.js` as a dispatcher. Suggested boundaries:

- `src/flows/home-conversation.js`
  - eligibility orchestration after routing precedence is resolved;
  - request classification handoff;
  - response and optional action delivery.
- `src/services/home-context.js`
  - read-only assembly of the verified, minimal Home snapshot;
  - no Telegram rendering and no AI prose.
- `src/services/home-conversation.js`
  - prompt construction;
  - constrained response schema;
  - provider call, parsing, and safe fallback.
- `src/services/home-actions.js`
  - allowlisted model intent to existing callback/destination mapping;
  - no arbitrary callback generation.
- `src/services/home-ui.js`
  - localized response/action rendering when deterministic rendering is useful.

Exact filenames may change during implementation, but these responsibilities should remain separate. Do not put snapshot queries, prompt bodies, or response parsing directly into `src/bot.js`.

Reuse existing domain services for invitations, discussions, Favorites, profiles, People, Saved Profiles, Stars, and settings. Do not duplicate their eligibility or mutation rules in the Home feature.

If snapshot assembly needs several independent read-only queries, run them concurrently where safe and tolerate optional-source failures. Bound total latency and return a partial truthful snapshot rather than waiting indefinitely.

## Suggested AI Response Contract

Prefer structured output so application code retains control:

```json
{
  "kind": "answer",
  "message": "Localized first-person response",
  "destination": "discussion_invitations",
  "follow_up": null
}
```

The exact schema may vary, but:

- `message` is localized prose;
- `destination` is either `null` or one member of a fixed allowlist;
- a destination never contains IDs or callback payloads generated by the model;
- `follow_up` is optional and constrained;
- application code validates every field and may discard an unsafe or stale destination;
- factual product claims must be grounded in snapshot fields.

For common deterministic questions such as invitation count or the location of a feature, implementation may answer locally without an AI call. Natural-language classification should remain conservative: when uncertain, a short conversational answer is safer than triggering an action.

## Cost And Performance

- Build only the context necessary for the detected request when practical.
- Use deterministic local answers for simple status/navigation questions where they remain natural.
- Keep prompt context compact and structured.
- Cap response length.
- Use existing operational AI health reporting.
- Apply a per-user rate limit appropriate for conversational use.
- Do not charge Stars for ordinary Home conversation in the MVP.
- Do not let Home conversation bypass paid suggestion rules by presenting equivalent formal suggestions for free.
- Timeouts and provider failures must leave Home fully usable through its reply keyboard.

## Validation And Test Plan

### Routing

- Ordinary text in `state: idle` plus global Home mode reaches Home conversation.
- The same text in Favorites, Discussions, People, Profile, Guide, onboarding, edit states, and active rooms does not.
- Global commands continue to win over Home conversation.
- Valid Home reply-keyboard labels continue to open their destinations.
- Localized stale labels are ignored and never sent to AI.
- `/command@BotName` forms retain existing behavior.

### Factual behavior

- Invitation answers use current invitation state.
- Discussion answers never claim unread counts.
- Quiet accounts receive a truthful optional direction.
- Partial snapshot failure does not create fabricated activity.
- Saved-profile privacy is never exposed.
- Hidden profile/discussion information is omitted.

### Actions

- Returned destinations come only from the application allowlist.
- Existing safe destination callbacks work.
- Stale actions revalidate.
- Mutations and Star spending still require their existing flows and confirmations.
- The model cannot inject callback payloads.

### UX and copy

- Persian and English preserve first-person Muze voice.
- Persian contains no tanwin or hamze-above-final-heh forms prohibited by `docs/bot-ux.md`.
- Responses remain concise.
- Repeated Home visits do not produce a long repeated introduction.
- General conversation is not forcibly converted into a product action.

### Failure and operations

- Provider timeout preserves Home mode and keyboard.
- Database or optional snapshot-source failure produces a truthful fallback.
- Rate limiting is low-noise.
- Analytics omit raw user and generated text by default.

After implementation, run at minimum:

- `npm.cmd run validate:translations`;
- `npm.cmd test`;
- focused Home routing, snapshot, action-allowlist, privacy, and failure tests.

## Rollout

Recommended rollout:

1. Add the read-only snapshot service and deterministic tests.
2. Add Home-only routing behind a rollout switch.
3. Support status, navigation, and short general conversation with no inline actions.
4. Add a small allowlist of existing safe destination buttons.
5. Review real usage categories and failure rates without retaining raw conversation text.
6. Decide later whether a compact status card and Refresh button solve a demonstrated need.

Do not add the card merely because it was part of the earlier concept. The conversational MVP should first test whether users naturally treat Home as the place to ask what is happening and where to go next.

## Future Status Card

If later evidence supports a Home card:

- render it only when the user explicitly enters or returns to Home;
- show at most one or two verified signals;
- include at most one primary contextual action;
- let Refresh edit the same card rather than send a new one;
- reuse `src/services/home-context.js`;
- do not show unread counts;
- do not turn it into a complete account dashboard;
- keep Home conversation available beneath it;
- avoid repeating unchanged explanations on frequent returns.

The card is a possible presentation of the same verified Home state, not a separate feature or data model.

### Speaking identity and personal-topic boundary

Muze is both the Telegram bot and the speaking personality. Home replies use first person for Muze and refer to the interface as “here” or by the exact section name. They do not describe Muze as a separate place or third party except when directly answering what Muze is.

Personal or emotional disclosures receive one short, respectful product-boundary response and do not enter AI generation or Home conversation memory. Home memory retains only the latest user/assistant pair for up to 10 minutes.

### Personal-topic boundary

Home uses a dedicated local boundary detector before normal AI conversation. Emotional, relationship, grief, loneliness, personal-health, and common follow-up phrasing receives one short product-scope reply, clears recent Home memory, is not stored, and is not sent to the normal conversation generator. Explicit self-harm or immediate-danger wording remains a separate safety category and is never downgraded to the ordinary personal-topic boundary.

## Product-scope allowlist

Home conversation is product-scoped rather than general-purpose. Messages are admitted only when they clearly concern a visible Muze section, product status, navigation, invitations, profile/taste features, or a direct product follow-up. Greetings remain locally supported. Everything else is classified as `outOfScope` and receives one short localized product-boundary response without calling the conversational provider or storing the turn.

Personal/emotional messages and out-of-scope messages clear ephemeral Home memory. Explicit immediate-danger or self-harm wording stays on a separate deterministic safety path and never invites further disclosure.

Home also reuses the shared in-memory sliding-window limiter from `update-rate-limit.js`, with a stricter Home window and an in-flight guard. Excess rapid Home messages are absorbed silently so a user burst cannot create a burst of AI calls, failure notices, or delayed replies. The outer general update limit remains in place for every section.


## Recommendation and discussion status routing

- Home never invents movie, series, music, or book recommendations. Recommendation requests point to the matching category in Interests. Home does not repeat the favorites threshold because the destination flow already explains its own eligibility state.
- Home may answer whether the user has an active or owned open discussion using verified discussion records.
- Recent join answers reuse the owner-join notification state and use its defined recent window; Home does not infer joins from member counts.


## Scope routing

Home uses a thin scope guard rather than a product allowlist. Commands, safety, spam protection, greetings, thanks, and clearly unrelated content requests are handled locally. Natural or ambiguous messages continue to the conversational model so it can understand product questions and short follow-ups without phrase-by-phrase regex patches.

Clearly unrelated requests such as jokes, poems, stories, translation, general knowledge, weather, and homework receive the short product boundary without loading a user snapshot or calling the answer generator. Requests that map to an existing Muze feature are redirected to the relevant section; for example, movie, music, and book recommendations go to the matching Interests category.

Snapshots are loaded only when the classified request needs verified user data, such as age, invitations, or discussion membership. Simple social replies and general product explanations do not load a snapshot.
