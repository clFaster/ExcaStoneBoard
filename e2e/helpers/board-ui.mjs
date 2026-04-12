const SELECTORS = {
  createBoardInput: '[data-testid="create-board-input"]',
  createBoardSubmit: '[data-testid="create-board-submit"]',
  settingsOpenButton: '[data-testid="open-settings-btn"]',
  settingsModal: '[data-testid="settings-modal"]',
  settingsCloseButton: '[data-testid="close-settings-btn"]',
  hideExportRowToggle: '[data-testid="toggle-hide-export-row"]',
  boardActionRename: '[data-testid="board-action-rename"]',
  boardActionDuplicate: '[data-testid="board-action-duplicate"]',
  commandPalette: '.command-palette',
  commandPaletteInput: '[data-testid="command-palette-input"]',
  commandPaletteCreateBoardItem: '[data-testid="command-palette-item-create-board"]',
  commandPaletteOpenSettingsItem: '[data-testid="command-palette-item-open-settings"]',
};

function boardNameXpath(name) {
  return `//span[contains(@class, "board-name") and normalize-space()="${name}"]`;
}

function boardMenuButtonXpath(name) {
  return `//div[contains(@class, "board-item")][.//span[contains(@class, "board-name") and normalize-space()="${name}"]]//button[contains(@class, "menu-btn")]`;
}

function boardItemXpath(name) {
  return `//div[contains(@class, "board-item")][.//span[contains(@class, "board-name") and normalize-space()="${name}"]]`;
}

export function uniqueBoardName(prefix) {
  return `${prefix} ${Date.now().toString(36)}`;
}

export async function waitForAppReady() {
  await browser.waitUntil(
    async () => {
      const createBoardInput = await $(SELECTORS.createBoardInput);
      if (await createBoardInput.isDisplayed().catch(() => false)) {
        return true;
      }

      const collapsedSidebar = await $('.board-list.collapsed');
      return collapsedSidebar.isDisplayed().catch(() => false);
    },
    {
      timeout: 30000,
      timeoutMsg: 'Expected app to become ready (expanded or collapsed sidebar view).',
    },
  );
}

export async function createBoard(name) {
  const createBoardInput = await $(SELECTORS.createBoardInput);
  await createBoardInput.waitForDisplayed({ timeout: 30000 });
  await createBoardInput.setValue(name);

  const createBoardSubmit = await $(SELECTORS.createBoardSubmit);
  await createBoardSubmit.click();

  await waitForBoardVisible(name);
}

export async function waitForBoardVisible(name) {
  const boardName = await $(boardNameXpath(name));
  await boardName.waitForDisplayed({ timeout: 10000 });
}

export async function openBoardMenu(name) {
  const boardItem = await $(boardItemXpath(name));
  await boardItem.waitForDisplayed({ timeout: 10000 });
  await boardItem.moveTo();

  const menuButton = await $(boardMenuButtonXpath(name));
  await menuButton.waitForClickable({ timeout: 10000 });
  await menuButton.click();
}

export async function renameBoard(currentName, nextName) {
  await openBoardMenu(currentName);

  const renameAction = await $(SELECTORS.boardActionRename);
  await renameAction.waitForDisplayed({ timeout: 10000 });
  await renameAction.click();

  const editInput = await $('.edit-input');
  await editInput.waitForDisplayed({ timeout: 10000 });
  await editInput.clearValue();
  await editInput.setValue(nextName);
  await browser.keys('Enter');

  await waitForBoardVisible(nextName);
}

export async function duplicateBoard(name) {
  await openBoardMenu(name);

  const duplicateAction = await $(SELECTORS.boardActionDuplicate);
  await duplicateAction.waitForDisplayed({ timeout: 10000 });
  await duplicateAction.click();

  const duplicatedName = `${name} (Copy)`;
  await waitForBoardVisible(duplicatedName);
  return duplicatedName;
}

export async function openSettings() {
  const settingsButton = await $(SELECTORS.settingsOpenButton);
  await settingsButton.waitForDisplayed({ timeout: 10000 });
  await settingsButton.click();

  const settingsModal = await $(SELECTORS.settingsModal);
  await settingsModal.waitForDisplayed({ timeout: 10000 });
}

export async function closeSettings() {
  const closeButton = await $(SELECTORS.settingsCloseButton);
  await closeButton.waitForDisplayed({ timeout: 10000 });
  await closeButton.click();

  const settingsModal = await $(SELECTORS.settingsModal);
  await settingsModal.waitForDisplayed({ reverse: true, timeout: 10000 });
}

export async function closeSettingsWithEscape() {
  await browser.keys('Escape');

  const settingsModal = await $(SELECTORS.settingsModal);
  await settingsModal.waitForDisplayed({ reverse: true, timeout: 10000 });
}

export async function openCommandPalette() {
  await browser.execute(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'p',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  const commandPalette = await $(SELECTORS.commandPalette);
  await commandPalette.waitForDisplayed({ timeout: 10000 });
}

export async function createBoardFromCommandPalette(name) {
  await openCommandPalette();

  const paletteInput = await $(SELECTORS.commandPaletteInput);
  await paletteInput.waitForDisplayed({ timeout: 10000 });
  await paletteInput.setValue('create new board');

  const createBoardItem = await $(SELECTORS.commandPaletteCreateBoardItem);
  await createBoardItem.waitForDisplayed({ timeout: 10000 });
  await browser.keys('Enter');

  await browser.waitUntil(
    async () => {
      const placeholder = await paletteInput.getAttribute('placeholder');
      return placeholder === 'Board name';
    },
    {
      timeout: 10000,
      timeoutMsg: 'Expected command palette to switch to board-name input mode.',
    },
  );

  await paletteInput.setValue(name);
  await browser.keys('Enter');
  await waitForBoardVisible(name);
}

export async function openSettingsFromCommandPalette() {
  await openCommandPalette();

  const paletteInput = await $(SELECTORS.commandPaletteInput);
  await paletteInput.waitForDisplayed({ timeout: 10000 });
  await paletteInput.setValue('open settings');

  const settingsItem = await $(SELECTORS.commandPaletteOpenSettingsItem);
  await settingsItem.waitForDisplayed({ timeout: 10000 });
  await browser.keys('Enter');

  const settingsModal = await $(SELECTORS.settingsModal);
  await settingsModal.waitForDisplayed({ timeout: 10000 });
}

export async function setHideExportRow(enabled) {
  const toggle = await $(SELECTORS.hideExportRowToggle);
  await toggle.waitForExist({ timeout: 10000 });

  const selected = await toggle.isSelected();
  if (selected !== enabled) {
    await browser.execute((element) => {
      element.click();
    }, toggle);
  }

  await browser.waitUntil(async () => (await toggle.isSelected()) === enabled, {
    timeout: 10000,
    timeoutMsg: `Hide export row toggle did not switch to ${enabled}.`,
  });
}

export async function assertExportRowHidden() {
  const exportRow = await $('.board-export-actions');
  const exists = await exportRow.isExisting();
  if (exists) {
    throw new Error('Expected export row to be hidden, but it is visible.');
  }
}

async function isSidebarCollapsed() {
  const collapsedSidebar = await $('.board-list.collapsed');
  return collapsedSidebar.isExisting();
}

export async function setSidebarCollapsed(collapsed) {
  const currentlyCollapsed = await isSidebarCollapsed();
  if (currentlyCollapsed === collapsed) {
    return;
  }

  const toggleSelector = collapsed
    ? 'button[title="Collapse sidebar"]'
    : 'button[title="Expand sidebar"]';
  const toggleButton = await $(toggleSelector);
  await toggleButton.waitForClickable({ timeout: 10000 });
  await toggleButton.click();

  await browser.waitUntil(async () => (await isSidebarCollapsed()) === collapsed, {
    timeout: 10000,
    timeoutMsg: `Sidebar did not switch to ${collapsed ? 'collapsed' : 'expanded'} state.`,
  });
}

export async function assertSidebarCollapsed() {
  await browser.waitUntil(async () => isSidebarCollapsed(), {
    timeout: 10000,
    timeoutMsg: 'Expected sidebar to be collapsed, but it remained expanded.',
  });
}

export async function restartAppSession() {
  await browser.reloadSession();
  await waitForAppReady();
}
