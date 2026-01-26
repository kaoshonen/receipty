# Wishlist

## Instructions for Codex
- This file is a list of future coding tasks for the Receipty project.
- Tasks in the "Tasks" section are not done yet.
- Work on **one** task at a time.
- Create a branch named: `feature/<short-slug>`
- Implement the task.
- Add or update tests when it makes sense.
- Run the project checks used in this repo.
- Commit with a clear message.
- Push the branch.
- Open a PR.
- When the PR is merged, mark the task complete by changing `[ ]` to `[x]` and move it to the "Complete" section at the bottom of the file.
- If a task needs splitting, add sub-tasks under it.

---

## Tasks

- [ ] **3. 12-hour clock and more legible time stamps on print job activity**
  - Update timestamp formatting to use 12-hour clock format (e.g., "Jan 26, 2026 3:45 PM" instead of ISO format).
  - Make timestamps more readable and human-friendly across all job displays:
    - Activity page table
    - Job detail page
    - Last job section on home page
  - Keep ISO format for database storage; only format for display.
  - Add a utility function to format timestamps for display (e.g., `formatDisplayTime` in `utils.ts`).
  - Update `ui.ts` to use the new formatting function when rendering timestamps.

- [ ] **4. Image support for printing**
  - Add drag-and-drop and file selection support for images on the print page.
  - Accept common image formats (PNG, JPEG, GIF, BMP).
  - Convert images to ESC/POS bitmap format compatible with Epson TM-T88IV (typically 384px width for 80mm paper).
  - Update `POST /api/print` to accept both text and image data (multipart/form-data or base64).
  - Add image processing utilities to convert images to ESC/POS bitmap commands.
  - Update `buildEscPosPayload` or create `buildEscPosImagePayload` function in `escpos.ts`.
  - Update UI (`public/app.js` and `src/ui.ts`) to support:
    - Drag-and-drop zone for images
    - File input button for image selection
    - Image preview before printing
    - Option to print text, image, or both together
  - Store image data or reference in jobs table (consider adding `image_data` BLOB column or `image_hash`).
  - Update job preview to show image thumbnail or indicator when job contains an image.

- [ ] **5. Print job preview thumbnails on Activity page**
  - Add visual preview of print jobs on the Activity page using one of these approaches:
    - Option A: Small thumbnail preview column in the table (e.g., 80px wide thumbnail)
    - Option B: Hover/mouseover tooltip that shows a larger preview image when hovering over a job row
  - For text jobs: Generate a preview image by rendering the text content as it would appear on a receipt (monospace font, receipt-width layout).
  - For image jobs: Show a thumbnail of the actual image that was printed.
  - Add API endpoint `GET /api/jobs/:id/preview` to serve preview images (generate on-demand or cache).
  - Update `src/ui.ts` to add preview column or hover attributes to activity table rows.
  - Update `public/activity.js` to handle hover events and display preview tooltip (if Option B).
  - Add CSS styling for thumbnails or hover preview tooltips in `public/styles.css`.
  - Consider caching preview images to avoid regenerating on every request.
  - Preview should match the receipt width (384px for 80mm paper) scaled down appropriately for display.

---

## Complete

- [x] **1. Print control page**
  - Add a new page in the app for robust printer controls.
  - Add buttons for:
    - Feed
    - Cut
    - Status report
  - When a command is issued, the app must confirm execution.
  - Confirmation must be based on a printer response.
  - If the printer cannot confirm, show a clear failure state.

- [x] **2. Add Docker Hub link**
  - Add a link near the GitHub link at the bottom of the page.
  - Docker Hub URL:
    - https://hub.docker.com/r/kaoshonen/receipty
