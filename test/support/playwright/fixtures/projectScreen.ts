// Copyright © 2022 The Radicle Upstream Contributors
//
// This file is part of radicle-upstream, distributed under the GPLv3
// with Radicle Linking Exception. For full terms see the included
// LICENSE file.

import { Page, Locator } from "@playwright/test";
import { Hotkeys } from "./hotkeys";

export class ProjectScreen {
  public actionBar: Locator;
  public commitCounter: Locator;
  public commitPage: Locator;
  public commitTeaser: Locator;
  public commitsTabButton: Locator;
  public editRemotePeersButton: Locator;
  public filesTabButton: Locator;
  public fileView: Locator;
  public header: Locator;
  public patchCounter: Locator;
  public patchList: Locator;
  public patchPage: Locator;
  public patchesTabButton: Locator;
  public selectBranchButton: Locator;
  public selectPeerButton: Locator;
  public sourceTree: Locator;
  public commitList: Locator;

  #page: Page;
  #hotkeys: Hotkeys;

  public constructor(page: Page) {
    this.#page = page;
    this.#hotkeys = new Hotkeys(page);

    this.actionBar = page.locator("[data-cy=action-bar]");
    this.commitCounter = page.locator(
      `[data-cy="commits-tab"] [data-cy="counter"]`
    );
    this.commitPage = page.locator("[data-cy=commit-page]");
    this.commitsTabButton = page.locator('role=button[name="commits tab"]');
    this.editRemotePeersButton = page.locator(
      'role=button[name="edit remote peers"]'
    );
    this.filesTabButton = page.locator('role=button[name="files tab"]');
    this.fileView = page.locator("[data-cy=file-view]");
    this.header = page.locator("[data-cy=header]");
    this.patchCounter = page.locator(
      `[data-cy="patches-tab"] [data-cy="counter"]`
    );
    this.patchList = page.locator("[data-cy=patch-list]");
    this.commitTeaser = page.locator("[data-cy=commit-teaser]");
    this.patchPage = page.locator("[data-cy=patch-page]");
    this.patchesTabButton = page.locator('role=button[name="patches tab"]');
    this.selectBranchButton = page.locator('role=button[name="select branch"]');
    this.selectPeerButton = page.locator('role=button[name="select peer"]');
    this.sourceTree = page.locator('[data-cy="source-tree"]');
    this.commitList = page.locator('[data-cy="history"]');
  }

  public async goToFilesTab(): Promise<void> {
    await this.filesTabButton.click();
  }

  public async goToPatchesTab(): Promise<void> {
    await this.patchesTabButton.click();
  }

  public async goToCommitsTab(): Promise<void> {
    await this.commitsTabButton.click();
  }

  public async goToPatchByTitle(title: string): Promise<void> {
    await this.patchList.locator(`text=${title}`).click();
  }

  public async addRemotes(peerIds: string[]): Promise<void> {
    await this.#page.locator("button[data-cy=manage-remotes]").click();
    for (const peerId of peerIds) {
      await this.#page
        .locator('[placeholder="Enter a Peer ID here"]')
        .fill(peerId);
      await this.#page
        .locator('[data-cy=remotes-modal] button:has-text("Add")')
        .click();
    }
    this.#hotkeys.closeModal();
  }

  public async selectPeer(peerHandle: string): Promise<void> {
    await this.selectPeerButton.click();
    await this.#page
      .locator(
        `[data-cy=peer-dropdown-container] >> [data-cy=peer-dropdown-entry]:has-text("${peerHandle}")`
      )
      .click();
  }

  public async selectBranch(branchName: string): Promise<void> {
    await this.selectBranchButton.click();
    await this.#page
      .locator(
        `[data-cy=revision-dropdown] >> .revision-entry:has-text("${branchName}")`
      )
      .click();
  }
}
