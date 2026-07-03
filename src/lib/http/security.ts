export function isSameOriginRequest(request: Request) {
  if (request.headers.get("x-cardkeeper-request") === "same-origin") {
    return true;
  }

  const origin = request.headers.get("origin");

  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite) {
    return fetchSite === "same-origin";
  }

  const referer = request.headers.get("referer");

  if (referer) {
    try {
      return new URL(referer).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }

  return false;
}
