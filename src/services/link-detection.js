const EXPLICIT_LINK_PATTERN = /(?:https?|ftp):\/\/|www\.|t\.me\/|telegram\.me\/|bale\.ai\//iu;
const EMAIL_PATTERN = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.(?:[\p{L}]{2,63}|xn--[a-z0-9-]{2,59})/iu;
const BARE_DOMAIN_PATTERN = /(?:^|[^\p{L}\p{N}@-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:[\p{L}]{2,63}|xn--[a-z0-9-]{2,59})(?=$|[^\p{L}\p{N}-])/iu;

function hasLink(value) {
  const text = String(value || "");
  return EXPLICIT_LINK_PATTERN.test(text)
    || EMAIL_PATTERN.test(text)
    || BARE_DOMAIN_PATTERN.test(text);
}

module.exports = {
  hasLink,
};
