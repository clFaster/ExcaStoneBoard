describe('System smoke', () => {
  it('creates a board and opens settings', async () => {
    const boardName = `System Test ${Date.now().toString(36)}`;

    const createBoardInput = await $('[data-testid="create-board-input"]');
    await createBoardInput.waitForDisplayed({ timeout: 30000 });
    await createBoardInput.setValue(boardName);

    const createBoardSubmit = await $('[data-testid="create-board-submit"]');
    await createBoardSubmit.click();

    const boardNameLabel = await $(
      `//span[contains(@class, "board-name") and normalize-space()="${boardName}"]`,
    );
    await boardNameLabel.waitForDisplayed({ timeout: 10000 });

    const openSettingsButton = await $('[data-testid="open-settings-btn"]');
    await openSettingsButton.click();

    const settingsModal = await $('[data-testid="settings-modal"]');
    await settingsModal.waitForDisplayed({ timeout: 10000 });

    const closeSettingsButton = await $('[data-testid="close-settings-btn"]');
    await closeSettingsButton.click();

    await settingsModal.waitForDisplayed({ reverse: true, timeout: 10000 });
  });
});
