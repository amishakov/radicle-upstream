// Copyright © 2022 The Radicle Upstream Contributors
//
// This file is part of radicle-upstream, distributed under the GPLv3
// with Radicle Linking Exception. For full terms see the included
// LICENSE file.

import * as Os from "node:os";
import * as Fs from "node:fs/promises";
import * as Path from "node:path";
import execa from "execa";
import waitOn from "wait-on";
import Semver from "semver";

import type * as ProxyRunner from "./support/proxyRunner";
import * as Process from "./support/process";

// Assert that the docker container with the test git-server is
// running. If it is not running, throw an error that explains how to
// run it.
export async function assertGitServerRunning(): Promise<void> {
  const containerName = "upstream-git-server-test";
  const notRunningMessage =
    "The git-server test container is required for this test. You can run it with `./scripts/git-server-test.sh`";
  try {
    const result = await execa("docker", [
      "container",
      "inspect",
      containerName,
      "--format",
      "{{.State.Running}}",
    ]);
    if (result.stdout !== "true") {
      throw new Error(notRunningMessage);
    }
  } catch (err: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((err as any).stderr === `Error: No such container: ${containerName}`) {
      throw new Error(notRunningMessage);
    } else {
      throw err;
    }
  }
}

// Assert that the `rad` CLI is installed and has the correct version.
export async function assertRadInstalled(): Promise<void> {
  const result = await execa("rad", ["--version"]);
  const versionConstraint = ">=0.4.0";
  const version = result.stdout.replace("rad ", "");
  if (!Semver.satisfies(version, versionConstraint)) {
    throw new Error(
      `rad version ${version} does not satisfy ${versionConstraint}`
    );
  }
}

// Returns a path to a directory where the test can store files.
//
// The directory is cleared before it is returned.
export async function prepareStateDir(): Promise<string> {
  const testPath = expect.getState().testPath;
  const stateDir = Path.resolve(
    `${testPath}--state`,
    expect.getState().currentTestName
  );
  await Fs.rm(stateDir, { recursive: true, force: true });
  await Fs.mkdir(stateDir, { recursive: true });
  return stateDir;
}

export async function startSshAgent(): Promise<string> {
  // We’re not using the state directory because of the size limit on
  // the socket path.
  const dir = await Fs.mkdtemp(Path.join(Os.tmpdir(), "upstream-test"));
  const sshAuthSock = Path.join(dir, "ssh-agent.sock");
  Process.spawn("ssh-agent", ["-D", "-a", sshAuthSock], {
    stdio: "inherit",
  });
  await waitOn({ resources: [sshAuthSock], timeout: 5000 });
  return sshAuthSock;
}

export async function createProject(
  proxy: ProxyRunner.RadicleProxy,
  name: string
): Promise<string> {
  const maintainerProjectPath = Path.join(proxy.checkoutPath, name);
  await proxy.spawn("git", [
    "init",
    maintainerProjectPath,
    "--initial-branch",
    "main",
  ]);
  await proxy.spawn(
    "git",
    ["commit", "--allow-empty", "--message", "initial commit"],
    {
      cwd: maintainerProjectPath,
    }
  );
  await proxy.spawn(
    "rad",
    ["init", "--name", name, "--default-branch", "main", "--description", ""],
    {
      cwd: maintainerProjectPath,
    }
  );

  await proxy.spawn(
    "git",
    ["config", "--add", "rad.seed", "http://localhost:8778"],
    {
      cwd: maintainerProjectPath,
    }
  );

  await proxy.spawn("rad", ["push"], {
    cwd: maintainerProjectPath,
  });

  const { stdout: projectUrn } = await proxy.spawn("rad", ["inspect"], {
    cwd: maintainerProjectPath,
  });

  return projectUrn;
}
