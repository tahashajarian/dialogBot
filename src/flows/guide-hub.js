const path = require("node:path");
const messages = require("../messages");
const { helpKeyboard } = require("../keyboards");
const { sendBannerPhoto } = require("../services/banner-media");
const { MODES, setStableNavigationState } = require("../services/reply-keyboard-navigation");

const GUIDE_BANNER_PATH = path.join(__dirname, "../../assets/guide-section-banner.jpg");

async function sendGuideHub(ctx, lang) {
  await setStableNavigationState(ctx, MODES.HELP);
  const text = messages[lang].helpText;
  const keyboard = helpKeyboard(lang);
  if (!ctx.replyWithPhoto || text.length > 1024) return ctx.reply(text, keyboard);
  try {
    return await sendBannerPhoto(ctx, {
      bannerKey: "guide_section_v1",
      localSource: GUIDE_BANNER_PATH,
      configuredFileId: process.env.GUIDE_SECTION_BANNER_FILE_ID,
      extra: { ...keyboard, caption: text },
    });
  } catch {
    return ctx.reply(text, keyboard);
  }
}

module.exports = { sendGuideHub };
