'use strict';

function getCookieValue(cookies, name) {
  const found = cookies.find((cookie) => cookie && cookie.name === name && !isCookieExpired(cookie));
  return found ? found.value : null;
}

function isCookieExpired(cookie) {
  if (!cookie || cookie.session) {
    return false;
  }

  if (typeof cookie.expirationDate !== 'number') {
    return false;
  }

  return cookie.expirationDate * 1000 <= Date.now();
}

function domainMatches(hostname, cookie) {
  const rawDomain = String(cookie.domain || '').trim().toLowerCase();
  if (!rawDomain) {
    return false;
  }

  const cookieDomain = rawDomain.replace(/^\./, '');
  const host = hostname.toLowerCase();

  if (cookie.hostOnly) {
    return host === cookieDomain;
  }

  return host === cookieDomain || host.endsWith(`.${cookieDomain}`);
}

function pathMatches(pathname, cookiePath) {
  const expectedPath = cookiePath || '/';
  return pathname.startsWith(expectedPath);
}

function buildCookieHeader(targetUrl, cookies) {
  const url = new URL(targetUrl);

  return cookies
    .filter((cookie) => {
      if (!cookie || typeof cookie.name !== 'string') {
        return false;
      }

      if (isCookieExpired(cookie)) {
        return false;
      }

      if (cookie.secure && url.protocol !== 'https:') {
        return false;
      }

      return domainMatches(url.hostname, cookie) && pathMatches(url.pathname, cookie.path);
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

module.exports = {
  buildCookieHeader,
  getCookieValue,
  isCookieExpired,
};
