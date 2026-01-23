import type { JobRow, JobListResult } from './jobs';
import { escapeHtml } from './utils';

function renderLayout(title: string, body: string, extraScripts: string[] = []): string {
  const scripts = extraScripts.map((src) => `<script src="${src}" defer></script>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Receipty</title>
  <link rel="icon" type="image/png" href="/static/receipty-logo.png" />
  <link rel="apple-touch-icon" href="/static/receipty-logo.png" />
  <link rel="stylesheet" href="/static/styles.css" />
  ${scripts}
</head>
<body>
  <div class="page">
    <header class="top-bar">
      <div class="brand">
        <a class="brand-link" href="/" aria-label="Receipty home">
          <img class="brand-mark" src="/static/receipty-logo.png" alt="Receipty logo" />
        </a>
        <div>
          <p class="eyebrow">Receipt Printer Control</p>
          <h1>${escapeHtml(title)}</h1>
        </div>
      </div>
      <nav class="nav">
        <a href="/" class="nav-link">Print</a>
        <a href="/activity" class="nav-link">Activity</a>
      </nav>
    </header>
    <main class="content">
      ${body}
    </main>
    <footer class="app-footer">
      <div class="footer-links">
        <a class="text-link" href="https://github.com/kaoshonen/receipty" target="_blank" rel="noreferrer">View on GitHub</a>
        <span class="footer-separator" aria-hidden="true">•</span>
        <a class="text-link" href="https://hub.docker.com/r/kaoshonen/receipty" target="_blank" rel="noreferrer">View on Docker Hub</a>
      </div>
    </footer>
  </div>
</body>
</html>`;
}

export function renderHome(options: {
  maxChars: number;
  lastJob?: JobRow;
  requiresApiKey: boolean;
}): string {
  const lastJobMarkup = options.lastJob
    ? `<div class="result-meta">
        <span class="chip ${escapeHtml(options.lastJob.status)}">${escapeHtml(options.lastJob.status)}</span>
        <span>Job #${options.lastJob.id}</span>
        <span>${escapeHtml(options.lastJob.created_at)}</span>
      </div>
      <p class="result-preview">${escapeHtml(options.lastJob.text || options.lastJob.preview || '')}</p>`
    : '<p class="result-empty">No jobs yet. Your first print will appear here.</p>';

  const apiKeyBlock = options.requiresApiKey
    ? `<label class="field">
        <span class="field-label">API key</span>
        <input id="api-key" type="password" placeholder="Enter API key" autocomplete="off" />
        <small class="hint">Required because the app is bound to a non-localhost address.</small>
      </label>`
    : '';

  const body = `
    <section class="card">
      <div class="status-row">
        <div class="status">
          <span class="status-label">Printer</span>
          <span id="printer-status" class="badge waiting">Checking...</span>
        </div>
        <div class="status">
          <span class="status-label">Characters</span>
          <span id="char-count" class="badge">0/${options.maxChars}</span>
        </div>
      </div>
      <label class="field">
        <span class="field-label">Receipt text</span>
        <textarea id="print-text" data-max="${options.maxChars}" placeholder="Type receipt text here..."></textarea>
      </label>
      ${apiKeyBlock}
      <button id="print-button" class="primary">Print Now</button>
      <div id="print-feedback" class="feedback hidden"></div>
    </section>

    <section class="card">
      <div class="card-header">
        <h2>Last Job</h2>
        <a class="text-link" href="/activity">View all</a>
      </div>
      <div id="last-job" class="result">
        ${lastJobMarkup}
      </div>
    </section>
  `;

  return renderLayout('Print', body, ['/static/app.js']);
}

export function renderActivity(data: JobListResult): string {
  const rows = data.items
    .map((job) => {
      const errorSummary = job.error ? escapeHtml(job.error.split('\n')[0].slice(0, 120)) : '';
      return `<tr>
        <td>${escapeHtml(job.created_at)}</td>
        <td>${escapeHtml(job.mode)}</td>
        <td>${job.bytes}</td>
        <td><span class="chip ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span></td>
        <td class="error">${errorSummary}</td>
        <td><a class="text-link" href="/jobs/${job.id}">Details</a></td>
        <td><button class="action-button" data-job-id="${job.id}" aria-label="Reprint job #${job.id}">Reprint</button></td>
      </tr>`;
    })
    .join('');

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const prevPage = Math.max(1, data.page - 1);
  const nextPage = Math.min(totalPages, data.page + 1);

  const body = `
    <section class="card">
      <div id="activity-feedback" class="feedback hidden"></div>
      <div class="table-wrap">
        <table id="activity-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Mode</th>
              <th>Bytes</th>
              <th>Result</th>
              <th>Error summary</th>
              <th>Details</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="7">No jobs yet.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="pager">
        <a class="text-link" href="/activity?page=${prevPage}&pageSize=${data.pageSize}">Prev</a>
        <span>Page ${data.page} of ${totalPages}</span>
        <a class="text-link" href="/activity?page=${nextPage}&pageSize=${data.pageSize}">Next</a>
      </div>
    </section>
  `;

  return renderLayout('Activity', body, ['/static/activity.js']);
}

export function renderJobDetail(job: JobRow): string {
  const errorBlock = job.error
    ? `<div class="card">
        <h2>Error Stack</h2>
        <pre>${escapeHtml(job.error)}</pre>
      </div>`
    : '';

  const body = `
    <section class="card">
      <div class="detail-grid">
        <div>
          <span class="field-label">Status</span>
          <span class="chip ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
        </div>
        <div>
          <span class="field-label">Timestamp</span>
          <p>${escapeHtml(job.created_at)}</p>
        </div>
        <div>
          <span class="field-label">Mode</span>
          <p>${escapeHtml(job.mode)}</p>
        </div>
        <div>
          <span class="field-label">Bytes</span>
          <p>${job.bytes}</p>
        </div>
      </div>
      <div class="preview">
        <span class="field-label">Preview</span>
        <pre>${escapeHtml(job.text || job.preview)}</pre>
      </div>
    </section>
    ${errorBlock}
  `;

  return renderLayout(`Job #${job.id}`, body);
}
