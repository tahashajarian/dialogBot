const fs = require("fs");
const path = require("path");

const messages = require("../src/messages");
const { SUPPORTED_LANGS } = require("../src/lang");
const { TASTE_LABEL_CATALOG } = require("../src/services/taste-label-classifier");

const SRC_DIR = path.join(__dirname, "..", "src");
const DIRECT_MESSAGE_KEY_PATTERN = /messages(?:\?\.)?\[[^\]]+\](?:\?\.)?\.([A-Za-z0-9_]+)/g;
const PLACEHOLDER_PATTERN = /\{[A-Za-z0-9_]+\}/g;

function walkJsFiles(dir) {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkJsFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

function getPlaceholders(value) {
  return [...String(value).matchAll(PLACEHOLDER_PATTERN)]
    .map((match) => match[0])
    .sort();
}

function addIssue(issues, message) {
  issues.push(`- ${message}`);
}

function getExpectedDynamicKeys() {
  const keys = new Set([
    "aiTasteLabelTitleFallback",
    "aiTasteLabelStyleFallback",
  ]);

  for (const [section, labels] of Object.entries(TASTE_LABEL_CATALOG)) {
    for (const label of Object.keys(labels)) {
      keys.add(`aiTasteLabelTitle_${section}_${label}`);
      keys.add(`aiTasteLabelStyle_${section}_${label}`);
    }
  }

  return keys;
}

function getDirectlyUsedKeys() {
  const keys = new Set();

  for (const file of walkJsFiles(SRC_DIR)) {
    const text = fs.readFileSync(file, "utf8");
    let match;

    while ((match = DIRECT_MESSAGE_KEY_PATTERN.exec(text))) {
      keys.add(match[1]);
    }
  }

  return keys;
}

function validate() {
  const issues = [];
  const langs = Object.keys(messages).sort();
  const supportedLangs = [...SUPPORTED_LANGS].sort();

  if (JSON.stringify(langs) !== JSON.stringify(supportedLangs)) {
    addIssue(
      issues,
      `messages languages (${langs.join(", ")}) do not match SUPPORTED_LANGS (${supportedLangs.join(", ")}).`,
    );
  }

  const allKeys = new Set(langs.flatMap((lang) => Object.keys(messages[lang] || {})));

  for (const lang of langs) {
    for (const key of allKeys) {
      if (!Object.prototype.hasOwnProperty.call(messages[lang], key)) {
        addIssue(issues, `${lang} is missing translation key "${key}".`);
        continue;
      }

      if (typeof messages[lang][key] !== "string" || !messages[lang][key].trim()) {
        addIssue(issues, `${lang}.${key} must be a non-empty string.`);
      }
    }
  }

  const baseLang = supportedLangs[0];
  for (const key of allKeys) {
    const basePlaceholders = getPlaceholders(messages[baseLang]?.[key]);

    for (const lang of supportedLangs.slice(1)) {
      const placeholders = getPlaceholders(messages[lang]?.[key]);

      if (JSON.stringify(placeholders) !== JSON.stringify(basePlaceholders)) {
        addIssue(
          issues,
          `${lang}.${key} placeholders (${placeholders.join(", ") || "none"}) do not match ${baseLang}.${key} (${basePlaceholders.join(", ") || "none"}).`,
        );
      }
    }
  }

  const expectedKeys = new Set([...getDirectlyUsedKeys(), ...getExpectedDynamicKeys()]);

  for (const key of expectedKeys) {
    for (const lang of supportedLangs) {
      if (!messages[lang]?.[key]) {
        addIssue(issues, `${lang} is missing required translation key "${key}".`);
      }
    }
  }

  if (issues.length) {
    console.error("Translation validation failed:");
    console.error(issues.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(`Translations OK: ${supportedLangs.join(", ")} (${allKeys.size} keys).`);
}

validate();
