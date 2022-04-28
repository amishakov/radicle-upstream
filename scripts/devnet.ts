#!/usr/bin/env -S node --require ts-node/register/transpile-only

// Copyright © 2022 The Radicle Upstream Contributors
//
// This file is part of radicle-upstream, distributed under the GPLv3
// with Radicle Linking Exception. For full terms see the included
// LICENSE file.

import * as yargs from "yargs";
import execa from "execa";
import * as Path from "path";
import * as Fs from "fs/promises";
import * as Crypto from "crypto";
import multibase from "multibase";
import assert from "assert";
import TweetNacl from "tweetnacl";

async function main() {
  yargs
    .command(upstreamCommand)
    .command(resetCommand)
    .command(shellCommand)
    // Don’t show a version and the --version flag
    .version(false)
    .strict()
    .fail((msg, err, yargs) => {
      if (err === undefined) {
        yargs.showHelp("error");
        console.error("");
        console.error(msg);
      } else {
        console.error(err);
      }
      process.exit(1);
    })
    .wrap(Math.min(100, yargs.terminalWidth()))
    .demandCommand().argv;
}

const upstreamCommand: yargs.CommandModule<
  unknown,
  {
    PEER_NO: number;
    bootstrap?: number;
  }
> = {
  command: "upstream PEER_NO",
  describe: "Run an upstream instance",
  builder: yargs =>
    yargs
      .positional("PEER_NO", {
        demandOption: true,
        type: "number",
        describe:
          "Number identifying the instance. This is used to derive the peer configuration. Must be between 1 and 100",
      })
      .options({
        headless: {
          type: "boolean",
          default: false,
          describe: "Only run upstream-proxy and not the frontend",
        },
      }),
  handler: async opts => {
    const peerConfig = makePeerConfig(opts.PEER_NO);

    if (opts.headless) {
      await exec(
        "cargo",
        [
          "run",
          "--bin=upstream-proxy",
          "--",
          "--unsafe-fast-keystore",
          "--dev-log",
        ],
        {
          stdio: "inherit",
          env: getProxyEnv(peerConfig),
        }
      );
    } else {
      await exec("cargo", ["build", "--bin", "upstream-proxy"]);
      await exec("yarn", ["run", "electron", "./native/index.js"], {
        stdio: "inherit",
        env: {
          NODE_ENV: "development",
          RADICLE_UPSTREAM_HTTP_PORT: peerConfig.httpPort.toString(),
          ...getProxyEnv(peerConfig),
        },
      });
    }
  },
};

const resetCommand: yargs.CommandModule<
  unknown,
  {
    PEER_NO: number;
  }
> = {
  command: "reset PEER_NO",
  describe: "Delete all data data for the peer re-initialize it",
  builder: yargs =>
    yargs.positional("PEER_NO", {
      demandOption: true,
      type: "number",
      describe: "Number identifying the peer. Must be between 1 and 100",
    }),
  handler: async opts => {
    const peerConfig = makePeerConfig(opts.PEER_NO);
    await Fs.rm(peerConfig.lnkHome, { recursive: true, force: true });
    await execa(
      "cargo",
      [
        "run",
        "--bin",
        "upstream-proxy-dev",
        "--",
        "init",
        peerConfig.userHandle,
      ],
      {
        stdio: "inherit",
        env: {
          LNK_HOME: peerConfig.lnkHome,
        },
      }
    );
  },
};

const shellCommand: yargs.CommandModule<unknown, { PEER_NO: number }> = {
  command: "shell PEER_NO",
  describe: [
    `Print a shell script that adds radicle programs to the search path and has
    them use the given peers identity and data.`,
    `Run this command as eval $(devnet shell 1)`,
  ]
    .map(r => r.replace(/\s+/g, " "))
    .join("\n\n"),
  builder: yargs =>
    yargs.positional("PEER_NO", {
      demandOption: true,
      type: "number",
      describe:
        "Number identifying the instance. This is used to derive the peer configuration. Must be between 1 and 100",
    }),
  handler: async opts => {
    const peerConfig = makePeerConfig(opts.PEER_NO);
    console.log(`export LNK_HOME="${peerConfig.lnkHome}"`);

    const devBinPath = Path.resolve(__dirname, "..", "target", "debug");
    console.log(`export PATH="${devBinPath}:$PATH"`);

    console.log("export RADICLE_UNSAFE_FAST_KEYSTORE=1");
  },
};

main();

interface PeerConfig {
  userHandle: string;
  peerId: string;
  httpPort: number;
  p2pPort: number;
  // Absolute path to LNK_HOME
  lnkHome: string;
}

// Get a Peer ID from a private key seed.
//
// Uses the same algorithm as `upstream-proxy-dev init`.
function peerIdFromKeySeed(seed: string): string {
  const seedHash = Crypto.createHash("sha256");
  seedHash.update(seed);
  const seedDigest = seedHash.digest();
  const key = TweetNacl.sign.keyPair.fromSeed(new Uint8Array(seedDigest));

  const paddedPkData = new Uint8Array([0, ...key.publicKey]);
  const peerIdBytes = multibase.encode("base32z", paddedPkData);
  return new TextDecoder("utf-8").decode(peerIdBytes);
}

function makePeerConfig(id: number): PeerConfig {
  assert(id > 0 && id < 100, `Peer ID ${id} is not in range`);
  const lnkHome = Path.resolve(
    __dirname,
    "..",
    "sandbox",
    "devnet",
    id.toString(),
    "lnk_home"
  );
  return {
    userHandle: id.toString(),
    peerId: peerIdFromKeySeed(id.toString()),
    httpPort: 24500 + id,
    p2pPort: 24600 + id,
    lnkHome,
  };
}

function getProxyEnv(
  peerConfig: PeerConfig
): Record<string, string | undefined> {
  return {
    LNK_HOME: peerConfig.lnkHome,
    RADICLE_PROXY_HTTP_LISTEN: `127.0.0.1:${peerConfig.httpPort}`,
    RADICLE_PROXY_PEER_LISTEN: `127.0.0.1:${peerConfig.p2pPort}`,
    RADICLE_PROXY_KEY_PASSPHRASE: "asdf",
    RADICLE_PROXY_GIT_SEEDS: `http://127.0.0.1:8778`,
  };
}

// Similar to `execa` but registers signal handlers so that on SIGTERM
// and SIGINT we wait for the child process to exit properly.
function exec(
  file: string,
  args: string[],
  options?: execa.Options
): execa.ExecaChildProcess {
  const child = execa(file, args, options);

  const signals = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.once(signal, async () => {
      child.kill(signal);
      await child;
      process.exit(0);
    });
  }

  return child;
}
