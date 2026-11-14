import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidBranch,
  sanitizeBranch,
  selectionFromBranch,
  rewriteText
} from "../src/index.mjs";

test("sanitizes Git branch names exactly like Cloudflare preview aliases", () => {
  assert.equal(sanitizeBranch("test/approval-workflow"), "test-approval-workflow");
  assert.equal(sanitizeBranch("Feature/DGS_Preview--One"), "feature-dgs-preview-one");
});

test("accepts safe Git branch names and rejects injection-shaped values", () => {
  assert.equal(isValidBranch("cleanup/remove-workflow-test"), true);
  assert.equal(isValidBranch("feature/../admin"), false);
  assert.equal(isValidBranch("https://malicious.example"), false);
  assert.equal(isValidBranch(""), false);
});

test("maps a selected branch to its isolated Cloudflare Preview alias", () => {
  assert.deepEqual(selectionFromBranch("feature/client-copy"), {
    mode: "pull-request",
    branch: "feature/client-copy",
    targetOrigins: [
      "https://feature-client-copy-dgs.digitalgrowthsociety.workers.dev"
    ]
  });
});

test("falls back to stable staging when no branch is selected", () => {
  assert.deepEqual(selectionFromBranch(null), {
    mode: "staging-fallback",
    branch: "staging",
    targetOrigins: ["https://staging.digitalgrowthsociety.org"]
  });
});

test("rewrites technical Worker origins to the branded preview origin", () => {
  const target = "https://feature-client-copy-dgs.digitalgrowthsociety.workers.dev";
  const source = `${target}/about https://dgs.digitalgrowthsociety.workers.dev/tina-content-proxy`;
  assert.equal(
    rewriteText(source, target),
    "https://preview.digitalgrowthsociety.org/about https://preview.digitalgrowthsociety.org/tina-content-proxy"
  );
});
