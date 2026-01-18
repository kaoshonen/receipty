(() => {
  const textarea = document.getElementById('print-text');
  const counter = document.getElementById('char-count');
  const printButton = document.getElementById('print-button');
  const feedback = document.getElementById('print-feedback');
  const statusBadge = document.getElementById('printer-status');
  const lastJob = document.getElementById('last-job');
  const apiKeyInput = document.getElementById('api-key');

  if (!textarea || !counter || !printButton || !feedback || !statusBadge || !lastJob) {
    return;
  }

  const maxChars = Number.parseInt(textarea.dataset.max || '0', 10);

  if (apiKeyInput) {
    const savedKey = window.localStorage.getItem('receipt_api_key');
    if (savedKey) {
      apiKeyInput.value = savedKey;
    }
  }

  const updateCounter = () => {
    const length = textarea.value.length;
    counter.textContent = `${length}/${maxChars}`;
  };

  const getApiKey = () => {
    if (!apiKeyInput) {
      return null;
    }
    const cached = window.localStorage.getItem('receipt_api_key');
    const current = apiKeyInput.value.trim();
    if (current.length > 0) {
      window.localStorage.setItem('receipt_api_key', current);
      return current;
    }
    return cached && cached.length > 0 ? cached : null;
  };

  const setFeedback = (message, isError) => {
    feedback.textContent = message;
    feedback.classList.remove('hidden');
    if (isError) {
      feedback.classList.add('error');
    } else {
      feedback.classList.remove('error');
    }
  };

  const updateStatusBadge = (connected) => {
    statusBadge.textContent = connected ? 'Connected' : 'Disconnected';
    statusBadge.classList.remove('ok', 'warn', 'waiting');
    statusBadge.classList.add(connected ? 'ok' : 'warn');
  };

  const refreshStatus = async () => {
    try {
      const headers = {};
      const apiKey = getApiKey();
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }
      const response = await fetch('/api/status', { headers });
      if (response.status === 401) {
        statusBadge.textContent = 'Auth Required';
        statusBadge.classList.remove('ok', 'warn', 'waiting');
        statusBadge.classList.add('warn');
        return;
      }
      if (!response.ok) {
        updateStatusBadge(false);
        return;
      }
      const data = await response.json();
      updateStatusBadge(Boolean(data.connected));
    } catch (error) {
      updateStatusBadge(false);
    }
  };

  const renderLastJob = (job) => {
    if (!job) {
      lastJob.innerHTML = '<p class="result-empty">No jobs yet.</p>';
      return;
    }
    const statusClass = job.status || 'queued';
    const escapeHtml = (value) =>
      String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
    lastJob.innerHTML = `
      <div class="result-meta">
        <span class="chip ${escapeHtml(statusClass)}">${escapeHtml(job.status)}</span>
        <span>Job #${escapeHtml(job.id)}</span>
        <span>${escapeHtml(job.createdAt)}</span>
      </div>
      <p class="result-preview">${escapeHtml(job.text || job.preview || '')}</p>
    `;
  };

  const pollJob = async (jobId) => {
    let attempts = 0;
    while (attempts < 20) {
      attempts += 1;
      try {
        const headers = {};
        const apiKey = getApiKey();
        if (apiKey) {
          headers['X-API-Key'] = apiKey;
        }
        const response = await fetch('/api/jobs?page=1&pageSize=20', { headers });
        if (response.ok) {
          const data = await response.json();
          const job = (data.items || []).find((item) => String(item.id) === String(jobId));
          if (job) {
            renderLastJob(job);
            if (job.status === 'succeeded' || job.status === 'failed') {
              return;
            }
          }
        }
      } catch (error) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };

  const submitPrint = async () => {
    const text = textarea.value;
    if (!text.trim()) {
      setFeedback('Enter text before printing.', true);
      return;
    }
    printButton.disabled = true;
    setFeedback('Sending to printer queue...', false);

    try {
      const headers = { 'Content-Type': 'application/json' };
      const apiKey = getApiKey();
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }
      const response = await fetch('/api/print', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text })
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Print failed.', true);
        return;
      }
      setFeedback(`Queued job #${data.jobId}.`, false);
      pollJob(data.jobId);
    } catch (error) {
      setFeedback('Print request failed. Check network and try again.', true);
    } finally {
      printButton.disabled = false;
    }
  };

  textarea.addEventListener('input', updateCounter);
  printButton.addEventListener('click', submitPrint);
  updateCounter();
  refreshStatus();
  setInterval(refreshStatus, 5000);
})();
