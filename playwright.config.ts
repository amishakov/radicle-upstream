// Copyright © 2022 The Radicle Upstream Contributors
//
// This file is part of radicle-upstream, distributed under the GPLv3
// with Radicle Linking Exception. For full terms see the included
// LICENSE file.

import { PlaywrightTestConfig, devices } from "@playwright/test";

const config: PlaywrightTestConfig = {
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // We can't parallelize because the tests use a single test seed node.
  workers: 1,
  use: {
    trace: "on-first-retry",
    actionTimeout: 5000,
  },
  globalSetup: require.resolve("test/support/playwright/globalSetup"),
  testDir: "test/e2e",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
};
export default config;
