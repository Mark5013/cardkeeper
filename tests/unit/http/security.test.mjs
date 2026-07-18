import assert from "node:assert/strict";
import test from "node:test";

import { isSameOriginRequest } from "../../../src/lib/http/security.ts";

const requestUrl = "https://cards.example.com/api/collection/card-id";

function makeRequest(headers = {}) {
  return new Request(requestUrl, { headers });
}

test("accepts an exact Origin with the custom request header", () => {
  const request = makeRequest({
    Origin: "https://cards.example.com",
    "X-Cardkeeper-Request": "same-origin",
  });

  assert.equal(isSameOriginRequest(request), true);
});

test("rejects a valid same-origin Origin without the custom request header", () => {
  const request = makeRequest({ Origin: "https://cards.example.com" });

  assert.equal(isSameOriginRequest(request), false);
});

test("rejects a forged custom request header without browser origin metadata", () => {
  const request = makeRequest({ "X-Cardkeeper-Request": "same-origin" });

  assert.equal(isSameOriginRequest(request), false);
});

test("rejects a cross-origin Origin even when fallback metadata looks same-origin", () => {
  const request = makeRequest({
    Origin: "https://attacker.example",
    Referer: "https://cards.example.com/collection",
    "Sec-Fetch-Site": "same-origin",
    "X-Cardkeeper-Request": "same-origin",
  });

  assert.equal(isSameOriginRequest(request), false);
});

test("rejects malformed and non-serialized Origin values", async (t) => {
  for (const origin of [
    "not a URL",
    "null",
    "https://cards.example.com/collection",
    "https://cards.example.com/",
    "https://cards.example.com.evil",
  ]) {
    await t.test(origin, () => {
      const request = makeRequest({
        Origin: origin,
        "X-Cardkeeper-Request": "same-origin",
      });

      assert.equal(isSameOriginRequest(request), false);
    });
  }
});

test("uses Sec-Fetch-Site only when Origin is absent", async (t) => {
  for (const [fetchSite, expected] of [
    ["same-origin", true],
    ["same-site", false],
    ["cross-site", false],
    ["none", false],
  ]) {
    await t.test(fetchSite, () => {
      const request = makeRequest({
        "Sec-Fetch-Site": fetchSite,
        "X-Cardkeeper-Request": "same-origin",
      });

      assert.equal(isSameOriginRequest(request), expected);
    });
  }
});

test("does not let Referer override conflicting fetch metadata", () => {
  const request = makeRequest({
    Referer: "https://cards.example.com/collection",
    "Sec-Fetch-Site": "cross-site",
    "X-Cardkeeper-Request": "same-origin",
  });

  assert.equal(isSameOriginRequest(request), false);
});

test("uses an exact Referer origin when Origin and Sec-Fetch-Site are absent", () => {
  const sameOriginRequest = makeRequest({
    Referer: "https://cards.example.com/collection?page=2",
    "X-Cardkeeper-Request": "same-origin",
  });
  const crossOriginRequest = makeRequest({
    Referer: "https://attacker.example/collection",
    "X-Cardkeeper-Request": "same-origin",
  });
  const malformedRequest = makeRequest({
    Referer: "not a URL",
    "X-Cardkeeper-Request": "same-origin",
  });

  assert.equal(isSameOriginRequest(sameOriginRequest), true);
  assert.equal(isSameOriginRequest(crossOriginRequest), false);
  assert.equal(isSameOriginRequest(malformedRequest), false);
});
