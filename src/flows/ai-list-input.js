const messages = require("../messages");
const {
  normalizeAiListItem,
} = require("../services/users");
const {
  isLowQualityAiListItem,
  validateMinimumLength,
} = require("../services/ai-input-quality");

function getAiListAddPrompt(lang, section, listType) {
  if (section === "random" && listType === "topTen") {
    return messages[lang].aiInterestTopTenAddPrompt;
  }
  if (section === "music") {
    return listType === "topTen"
      ? messages[lang].aiMusicFavoritesAddPrompt
      : messages[lang].aiMusicListManageAddPrompt;
  }
  if (listType === "topTen" && section === "movies") return messages[lang].aiMovieFavoritesAddPrompt;
  if (listType === "topTen" && section === "series") return messages[lang].aiSeriesFavoritesAddPrompt;
  if (listType === "topTen" && section === "books") return messages[lang].aiBookFavoritesAddPrompt;
  return messages[lang].aiListManageAddPrompt;
}

function normalizeAudioTitle(value) {
  return String(value || "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/_+/g, " ")
    .replace(/^\s*\d{1,3}\s*[-._)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAudioDocument(document = {}) {
  const mimeType = String(document.mime_type || document.mimeType || "").toLowerCase();
  const fileName = String(document.file_name || document.fileName || "").toLowerCase();
  return mimeType.startsWith("audio/")
    || /\.(mp3|m4a|aac|flac|ogg|oga|wav|opus|wma)$/i.test(fileName);
}

function getMeaningfulMusicTitle(message = {}) {
  const audio = message.audio || {};
  const document = isAudioDocument(message.document) ? message.document : {};
  const candidates = [
    audio.title,
    audio.file_name,
    audio.fileName,
    document.file_name,
    document.fileName,
  ];

  for (const candidate of candidates) {
    const title = normalizeAudioTitle(candidate);
    if (
      validateMinimumLength(title).valid
      && !isLowQualityAiListItem(title)
      && !/^(audio|track|music|song)(?:\s*\d+)?$/i.test(title)
    ) {
      return title;
    }
  }

  return "";
}

function resolveAiListAddInput(ctx, section, text) {
  const typedItem = normalizeAiListItem(text);
  if (typedItem) {
    return { item: typedItem, reason: "" };
  }

  if (
    section === "music"
    && (ctx.message?.audio || isAudioDocument(ctx.message?.document))
  ) {
    const musicTitle = getMeaningfulMusicTitle(ctx.message);
    return musicTitle
      ? { item: musicTitle, reason: "" }
      : { item: "", reason: "untitled_audio" };
  }

  return {
    item: "",
    reason: ctx.message ? "unsupported_media" : "empty",
  };
}

module.exports = {
  getAiListAddPrompt,
  getMeaningfulMusicTitle,
  isAudioDocument,
  resolveAiListAddInput,
};
