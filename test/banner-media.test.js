const test = require("node:test");
const assert = require("node:assert/strict");

const AppSetting = require("../src/models/app-setting");
const {
  SETTINGS_KEY,
  resetBannerFileIdMemoryCache,
  sendBannerPhoto,
} = require("../src/services/banner-media");

test("banner delivery persists the largest uploaded photo file id and reuses it", async () => {
  const originalFindOne = AppSetting.findOne;
  const originalFindOneAndUpdate = AppSetting.findOneAndUpdate;
  const values = {};
  const sentPhotos = [];

  AppSetting.findOne = () => ({
    lean: async () => ({ key: SETTINGS_KEY, values: { ...values } }),
  });
  AppSetting.findOneAndUpdate = async (_filter, update) => {
    for (const [field, value] of Object.entries(update?.$set || {})) {
      if (field.startsWith("values.")) values[field.slice("values.".length)] = value;
    }
    for (const field of Object.keys(update?.$unset || {})) {
      if (field.startsWith("values.")) delete values[field.slice("values.".length)];
    }
    return { key: SETTINGS_KEY, values: { ...values } };
  };

  const ctx = {
    user: { _id: "persist-banner-cache" },
    replyWithPhoto: async (photo, extra) => {
      sentPhotos.push({ photo, extra });
      return {
        message_id: sentPhotos.length,
        photo: [
          { file_id: "small-file-id", width: 320, height: 107 },
          { file_id: "large-file-id", width: 1280, height: 427 },
        ],
      };
    },
  };

  try {
    resetBannerFileIdMemoryCache();
    await sendBannerPhoto(ctx, {
      bannerKey: "test_banner",
      localSource: "C:\\assets\\test-banner.jpg",
      extra: { caption: "Test" },
    });
    assert.deepEqual(sentPhotos[0].photo, { source: "C:\\assets\\test-banner.jpg" });
    assert.equal(values.test_banner, "large-file-id");

    resetBannerFileIdMemoryCache();
    await sendBannerPhoto(ctx, {
      bannerKey: "test_banner",
      localSource: "C:\\assets\\test-banner.jpg",
      extra: { caption: "Test again" },
    });
    assert.equal(sentPhotos[1].photo, "large-file-id");
  } finally {
    resetBannerFileIdMemoryCache();
    AppSetting.findOne = originalFindOne;
    AppSetting.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("banner delivery clears an invalid stored file id and uploads the local asset", async () => {
  const originalFindOne = AppSetting.findOne;
  const originalFindOneAndUpdate = AppSetting.findOneAndUpdate;
  const values = { stale_banner: "stale-file-id" };
  const sentPhotos = [];

  AppSetting.findOne = () => ({ lean: async () => ({ key: SETTINGS_KEY, values: { ...values } }) });
  AppSetting.findOneAndUpdate = async (_filter, update) => {
    for (const [field, value] of Object.entries(update?.$set || {})) {
      if (field.startsWith("values.")) values[field.slice("values.".length)] = value;
    }
    for (const field of Object.keys(update?.$unset || {})) {
      if (field.startsWith("values.")) delete values[field.slice("values.".length)];
    }
    return { key: SETTINGS_KEY, values: { ...values } };
  };

  const ctx = {
    user: { _id: "recover-banner-cache" },
    replyWithPhoto: async (photo) => {
      sentPhotos.push(photo);
      if (photo === "stale-file-id") throw new Error("Bad Request: wrong file identifier/HTTP URL specified");
      return {
        message_id: 1,
        photo: [{ file_id: "replacement-file-id", width: 1280, height: 427 }],
      };
    },
  };

  try {
    resetBannerFileIdMemoryCache();
    await sendBannerPhoto(ctx, {
      bannerKey: "stale_banner",
      localSource: "C:\\assets\\replacement.jpg",
      extra: { caption: "Recovered" },
    });
    assert.equal(sentPhotos[0], "stale-file-id");
    assert.deepEqual(sentPhotos[1], { source: "C:\\assets\\replacement.jpg" });
    assert.equal(values.stale_banner, "replacement-file-id");
  } finally {
    resetBannerFileIdMemoryCache();
    AppSetting.findOne = originalFindOne;
    AppSetting.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
