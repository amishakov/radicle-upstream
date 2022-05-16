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

import * as PeerRunner from "./support/peerRunner";
import * as Process from "./support/process";
import { retryOnError } from "ui/src/retryOnError";

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
export async function prepareStateDir(
  testPath: string,
  testName: string
): Promise<string> {
  const stateDir = Path.resolve(`${testPath}--state`, testName);
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

// Call `fn` until it does not throw an error and return the result. Re-throws
// the error raised by `fn()` if it still fails after two seconds.
export function retry<T>(fn: () => Promise<T>): Promise<T> {
  return retryOnError(fn, () => true, 100, 30);
}

// Create a project using the rad CLI.
export async function createProject(
  proxy: PeerRunner.UpstreamPeer,
  name: string
): Promise<{ urn: string; checkoutPath: string }> {
  const checkoutPath = Path.join(proxy.checkoutPath, name);
  await proxy.spawn("git", ["init", checkoutPath, "--initial-branch", "main"]);
  await proxy.spawn(
    "git",
    ["commit", "--allow-empty", "--message", "initial commit"],
    {
      cwd: checkoutPath,
    }
  );
  await proxy.spawn(
    "rad",
    ["init", "--name", name, "--default-branch", "main", "--description", ""],
    {
      cwd: checkoutPath,
    }
  );

  const { stdout: urn } = await proxy.spawn("rad", ["inspect"], {
    cwd: checkoutPath,
  });

  await proxy.spawn(
    "git",
    ["config", "--add", "rad.seed", PeerRunner.SEED_URL],
    {
      cwd: checkoutPath,
    }
  );

  return { urn, checkoutPath };
}

// Create and publish a project using the rad CLI and return the Project ID.
// Wait until the proxy registers the seed for the project.
export async function createAndPublishProject(
  proxy: PeerRunner.UpstreamPeer,
  name: string
): Promise<{ urn: string; checkoutPath: string }> {
  const { urn, checkoutPath } = await createProject(proxy, name);

  await proxy.spawn("rad", ["push"], {
    cwd: checkoutPath,
  });

  await retry(async () => {
    const project = await proxy.proxyClient.project.get(urn);
    if (project.seed === null) {
      throw new Error("Proxy hasn't set the project seed yet.");
    }
  });

  return { urn, checkoutPath };
}

// Fork a project by running the same commands as provided by the Fork button
// in the UI.
//
// Return the project checkout path.
export async function forkProject(
  projectId: string,
  projectName: string,
  peer: PeerRunner.UpstreamPeer
): Promise<string> {
  const projectCheckoutPath = Path.join(peer.checkoutPath, projectName);

  await peer.spawn("rad", ["checkout", projectId], {
    cwd: peer.checkoutPath,
  });
  // Publish the peer's default branch.
  // See <https://github.com/radicle-dev/radicle-upstream/issues/2795>.
  await peer.spawn("rad", ["push", "--seed", "127.0.0.1:8778"], {
    cwd: projectCheckoutPath,
  });
  await peer.spawn("rad", ["sync", "--self", "--seed", "127.0.0.1:8778"], {
    cwd: projectCheckoutPath,
  });

  return projectCheckoutPath;
}

// If no branch name is supplied, create patch using the upstream CLI.
// If a branch name is supplied, update an existing patch.
// Return the patch branch name.
export async function createOrUpdatePatch(
  title: string,
  description: string,
  peer: PeerRunner.UpstreamPeer,
  projectCheckoutPath: string,
  commitMessage: string = "changes",
  branchName?: string
): Promise<string> {
  const branchName_ = branchName || `patch-branch-${PeerRunner.randomTag()}`;
  const checkoutArgs = branchName ? [branchName_] : ["-b", branchName_];

  // Starting from the main branch allows us to create multiple
  // independent patches by running this function multiple times.
  await peer.spawn("git", ["checkout", "main"], {
    cwd: projectCheckoutPath,
  });

  await peer.spawn("git", ["checkout", ...checkoutArgs], {
    cwd: projectCheckoutPath,
  });
  await peer.spawn(
    "git",
    ["commit", "--allow-empty", "--message", commitMessage],
    {
      cwd: projectCheckoutPath,
    }
  );

  const action = branchName ? "update" : "create";
  await peer.spawn(
    "upstream",
    ["patch", action, "-m", `${title}\n\n${description}`],
    {
      cwd: projectCheckoutPath,
    }
  );

  return branchName_;
}

export async function mergeOwnPatch(
  peer: PeerRunner.UpstreamPeer,
  projectCheckoutPath: string,
  branchName: string
): Promise<void> {
  await peer.spawn("git", ["checkout", "main"], {
    cwd: projectCheckoutPath,
  });
  await peer.spawn("git", ["merge", "--ff-only", branchName], {
    cwd: projectCheckoutPath,
  });
  await peer.spawn("rad", ["push", "--seed", "127.0.0.1:8778"], {
    cwd: projectCheckoutPath,
  });

  await peer.spawn("rad", ["push", "--seed", "127.0.0.1:8778"], {
    cwd: projectCheckoutPath,
  });
}
