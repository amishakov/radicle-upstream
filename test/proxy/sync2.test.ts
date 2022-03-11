// Copyright © 2022 The Radicle Upstream Contributors
//
// This file is part of radicle-upstream, distributed under the GPLv3
// with Radicle Linking Exception. For full terms see the included
// LICENSE file.

import { afterEach, test } from "@jest/globals";
import * as Fs from "fs/promises";
import execa from "execa";
import * as Path from "path";
import waitOn from "wait-on";
import * as ProxyEvents from "proxy-client/events";
import * as ProxyRunner from "./support/proxyRunner";
import * as Process from "./support/process";

const ROOT_PATH = Path.resolve(__dirname, "..", "..");
const CARGO_TARGET_DIR =
  process.env.CARGO_TARGET_DIR ?? Path.join(ROOT_PATH, "target");
const BIN_PATH = Path.join(CARGO_TARGET_DIR, "debug");
const PATH = [BIN_PATH, process.env.PATH].join(Path.delimiter);

// TODO
// Currently the tests require you to run the Git seed with a docker
// container in the background:
//
//     docker run --init -p 8778:8778 gcr.io/radicle-services/git-server:latest  --allow-unauthorized-keys
//
// The tests should take care of that.

afterEach(async () => {
  ProxyRunner.killAllProcesses();
});

async function createWorkdir(testName: string): Promise<string> {
  const workdir = Path.resolve(__dirname, "..", "workdir", testName);
  await Fs.rm(workdir, { recursive: true, force: true });
  await Fs.mkdir(workdir, { recursive: true });
  return workdir;
}

async function startSshAgent(workdir: string): Promise<string> {
  const sshAuthSock = Path.join(workdir, "ssh-agent.sock");
  Process.spawn("ssh-agent", ["-D", "-a", sshAuthSock], {
    stdio: "inherit",
  });
  await waitOn({ resources: [sshAuthSock], timeout: 5000 });
  return sshAuthSock;
}

test("updates", async () => {
  const workdir = await createWorkdir("updates");
  const sshAuthSock = await startSshAgent(workdir);
  // TODO We need a random user handle so that the Radicle identity IDs
  // are different between runs. This will not be necessary anymore
  // once restart the git server between every test run.
  const maintainerName = `maintainer-${Math.random()}`;

  await execa(
    Path.join(BIN_PATH, "upstream-proxy-dev"),
    [
      "--lnk-home",
      Path.join(workdir, "maintainer_lnk_home"),
      "init",
      maintainerName,
    ],
    {
      env: {
        SSH_AUTH_SOCK: sshAuthSock,
      },
    }
  );

  const maintainer = new ProxyRunner.RadicleProxy({
    dataPath: workdir,
    name: maintainerName,
  });
  await maintainer.start();

  // TODO We can, and probably should, use `rad init`.
  const project = await maintainer.proxyClient.project.create({
    repo: {
      type: "new",
      path: maintainer.checkoutPath,
      name: "foo",
    },
    description: "",
    defaultBranch: "main",
  });

  await Process.spawn(
    "git",
    ["config", "--add", "rad.seed", "http://localhost:8778"],
    {
      stdio: "inherit",
      cwd: Path.join(maintainer.checkoutPath, "foo"),
    }
  );

  await Process.prefixOutput(
    Process.spawn("rad", ["push"], {
      cwd: Path.join(maintainer.checkoutPath, "foo"),
      shell: true,
      env: {
        SSH_AUTH_SOCK: sshAuthSock,
        LNK_HOME: Path.join(maintainer.lnkHome),
        PATH,
      },
    }),
    "maintainer-shell"
  );

  const contributor = new ProxyRunner.RadicleProxy({
    dataPath: workdir,
    name: `contributor-${Math.random()}`,
    httpPort: 30001,
    gitSeeds: ["http://localhost:8778"],
  });

  await contributor.start();
  // TODO Assert that we can get the project from the contributor API
  // by using `withRetry` instead of relying on the events.
  const updated = contributor.proxyClient
    .events()
    .filter(ev => {
      console.log(ev);
      return (
        ev.type === ProxyEvents.EventType.ProjectUpdated &&
        ev.urn === project.urn
      );
    })
    .firstToPromise();
  await contributor.proxyClient.project.requestSubmit(project.urn);
  await updated;

  // TODO write a test case involving patches
}, 10000);
