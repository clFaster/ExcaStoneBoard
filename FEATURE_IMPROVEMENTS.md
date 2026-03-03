# ExcaStoneBoard Feature and Improvement Backlog

This backlog is based on the current codebase (React + Tauri, local SQLite storage, board/folder drag-and-drop, import/export, and image export).

## Product Features

1. **Board search and quick filter**  
   Add a search box for board names (and optionally folder names) with instant filtering.

2. **Favorites / pinned boards**  
   Let users pin important boards to the top of the sidebar.

3. **Tags and smart grouping**  
   Add tags per board and allow filtering by tag (e.g., `client`, `draft`, `final`).

4. **Board thumbnails and gallery mode**  
   Generate and display snapshots in the sidebar or a dedicated gallery view (the `thumbnail` field already exists in models).

5. **Board templates**  
   Support creating boards from templates (meeting notes, flowcharts, architecture diagrams, etc.).

6. **Recently opened boards**  
   Provide a section for recently accessed boards to improve navigation speed.

7. **Trash / recycle bin**  
   Soft-delete boards and allow restore before permanent deletion.

8. **Bulk actions**  
   Enable multi-select for delete, duplicate, move to folder, and export.

9. **Board metadata panel**  
   Show and edit metadata (created date, last edited, tags, collaboration URL, notes).

10. **Board archiving**  
    Add archive state so old boards are hidden from day-to-day view without deleting them.

11. **Template-based folder creation**  
    Allow creating a full workspace (folders + starter boards) from presets.

12. **Command palette**  
    Add a `Ctrl/Cmd + K` command launcher for fast actions (open board, create board, export, settings).

## Collaboration and Sharing

13. **Collaboration link management in UI**  
    Expose `collaboration_link` in the frontend (backend command already exists) and allow opening/copying links quickly.

14. **Deep-link handling end-to-end**  
    Complete the deep-link flow in frontend (`deep-link-received`) to open the matching board or create one from URL.

15. **Share package export**  
    Export a board plus metadata/assets as a portable package for handoff.

## Data, Reliability, and UX

16. **Snapshot history / version restore**  
    Keep lightweight snapshots per board and allow rollback to previous versions.

17. **Autosave status indicator**  
    Show states like `Saving...`, `Saved`, `Save failed` so users trust data persistence.

18. **Import conflict resolution modes**  
    During import, provide explicit actions: skip, rename copy, replace existing, merge folders.

19. **Export/import folder structure**  
    Preserve folder hierarchy in backup files (current export focuses on boards only).

20. **Data integrity checker**  
    Add a maintenance action that validates board records, missing data rows, and broken folder references.

21. **Performance improvements for large libraries**  
    Virtualize long board lists and reduce expensive full reloads (`loadBoards`) after every operation.

22. **Theme preference support**  
    Add light/dark/system preference instead of forcing dark mode in the Excalidraw frame.

23. **Keyboard accessibility pass**  
    Improve keyboard-only operation for sidebar actions, menus, drag/drop alternatives, and modals.

24. **Crash diagnostics export**  
    Add a user-facing “Export diagnostics” action with app version, platform info, and sanitized logs.

## Developer Experience and Quality

25. **Automated tests**  
    Add Rust command tests + frontend component/integration tests for critical flows (create/save/import/reorder).

26. **Linting and formatting gates** ✅  
    Added ESLint/Prettier (frontend) and `clippy`/`rustfmt` (backend) in CI for consistency and early issue detection.

27. **Error standardization**  
    Introduce structured error types/codes from Rust commands to improve frontend error handling.

28. **Observability for slow operations**  
    Track timing for load/import/export operations to identify bottlenecks on larger datasets.
