import {
  assertExportRowHidden,
  closeSettings,
  createBoard,
  duplicateBoard,
  openSettings,
  reloadAppWindow,
  renameBoard,
  restartAppSession,
  setHideExportRow,
  uniqueBoardName,
  waitForAppReady,
  waitForBoardVisible,
} from '../helpers/board-ui.mjs';

describe('System suite', () => {
  it('smoke: creates a board and opens settings', async () => {
    const boardName = uniqueBoardName('Smoke Board');

    await createBoard(boardName);
    await openSettings();
    await closeSettings();
  });

  it('lifecycle: creates, renames, and duplicates a board', async () => {
    const createdName = uniqueBoardName('Lifecycle Board');
    const renamedName = `${createdName} Renamed`;

    await createBoard(createdName);
    await renameBoard(createdName, renamedName);
    const duplicatedName = await duplicateBoard(renamedName);

    await waitForBoardVisible(renamedName);
    await waitForBoardVisible(duplicatedName);
  });

  it('persistence: keeps created boards after app restart', async () => {
    const boardName = uniqueBoardName('Persistence Board');

    await createBoard(boardName);
    await restartAppSession();
    await waitForBoardVisible(boardName);
  });

  it('settings persistence: keeps hide export row after app window reload', async () => {
    await waitForAppReady();
    await openSettings();
    await setHideExportRow(true);
    await closeSettings();

    await assertExportRowHidden();

    await reloadAppWindow();
    await assertExportRowHidden();

    await openSettings();
    await setHideExportRow(false);
    await closeSettings();
  });
});
