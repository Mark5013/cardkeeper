export function isSameOriginRequest(request: Request) {
  if (request.headers.get("x-cardkeeper-request") !== "same-origin") {
    return false;
  }

  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }

  const origin = request.headers.get("origin");

  if (origin !== null) {
    try {
      const originUrl = new URL(origin);

      return origin === originUrl.origin && originUrl.origin === requestOrigin;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite !== null) {
    return fetchSite === "same-origin";
  }

  const referer = request.headers.get("referer");

  if (referer !== null) {
    try {
      return new URL(referer).origin === requestOrigin;
    } catch {
      return false;
    }
  }

  return false;
}
