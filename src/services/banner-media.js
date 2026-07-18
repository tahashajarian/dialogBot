const AppSetting = require("../models/app-setting");

const SETTINGS_KEY = "telegram-banner-file-ids";
const memoryFileIds = new Map();
const loadedKeys = new Set();

function canPersistBannerFileIds(ctx) {
  return Boolean(ctx?.persistBannerFileIds || ctx?.user?._id);
}

function getLargestPhotoFileId(message) {
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  const largest = photos
    .filter((photo) => String(photo?.file_id || "").trim())
    .sort((left, right) => (
      (Number(right?.width) || 0) * (Number(right?.height) || 0)
      - (Number(left?.width) || 0) * (Number(left?.height) || 0)
    ))[0];
  return String(largest?.file_id || "").trim();
}

function isInvalidBannerFileIdError(error) {
  const description = String(
    error?.description
    || error?.response?.description
    || error?.response?.data?.description
    || error?.message
    || "",
  ).toLowerCase();
  return description.includes("wrong file identifier")
    || description.includes("invalid file id")
    || description.includes("invalid file_id")
    || description.includes("file reference expired");
}

async function getStoredBannerFileId(ctx, bannerKey) {
  if (!canPersistBannerFileIds(ctx)) return "";
  if (loadedKeys.has(bannerKey)) return memoryFileIds.get(bannerKey) || "";
  try {
    const setting = await AppSetting.findOne({ key: SETTINGS_KEY }).lean();
    const fileId = String(setting?.values?.[bannerKey] || "").trim();
    loadedKeys.add(bannerKey);
    if (fileId) memoryFileIds.set(bannerKey, fileId);
    return fileId;
  } catch {
    return "";
  }
}

async function saveBannerFileId(ctx, bannerKey, fileId) {
  if (!canPersistBannerFileIds(ctx) || !fileId) return false;
  memoryFileIds.set(bannerKey, fileId);
  loadedKeys.add(bannerKey);
  try {
    await AppSetting.findOneAndUpdate(
      { key: SETTINGS_KEY },
      {
        $set: {
          [`values.${bannerKey}`]: fileId,
          updatedAt: new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
    return true;
  } catch {
    return false;
  }
}

async function forgetBannerFileId(ctx, bannerKey) {
  memoryFileIds.delete(bannerKey);
  loadedKeys.add(bannerKey);
  if (!canPersistBannerFileIds(ctx)) return false;
  try {
    await AppSetting.findOneAndUpdate(
      { key: SETTINGS_KEY },
      {
        $unset: { [`values.${bannerKey}`]: "" },
        $set: { updatedAt: new Date() },
      },
    );
    return true;
  } catch {
    return false;
  }
}

async function sendBannerPhoto(ctx, {
  bannerKey,
  localSource,
  extra,
  configuredFileId = "",
}) {
  const environmentFileId = String(configuredFileId || "").trim();
  const storedFileId = await getStoredBannerFileId(ctx, bannerKey);
  const preferredFileId = storedFileId || environmentFileId;
  if (preferredFileId) {
    try {
      const sent = await ctx.replyWithPhoto(preferredFileId, extra);
      const returnedFileId = getLargestPhotoFileId(sent);
      if (returnedFileId && returnedFileId !== storedFileId) {
        await saveBannerFileId(ctx, bannerKey, returnedFileId);
      }
      return sent;
    } catch (error) {
      if (!isInvalidBannerFileIdError(error)) throw error;
      if (storedFileId) await forgetBannerFileId(ctx, bannerKey);
    }
  }

  const sent = await ctx.replyWithPhoto({ source: localSource }, extra);
  const uploadedFileId = getLargestPhotoFileId(sent);
  if (uploadedFileId) await saveBannerFileId(ctx, bannerKey, uploadedFileId);
  return sent;
}

function resetBannerFileIdMemoryCache() {
  memoryFileIds.clear();
  loadedKeys.clear();
}

module.exports = {
  SETTINGS_KEY,
  getLargestPhotoFileId,
  isInvalidBannerFileIdError,
  resetBannerFileIdMemoryCache,
  sendBannerPhoto,
};
