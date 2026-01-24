(() => {
  const buttons = Array.from(document.querySelectorAll('[data-command]'));
  const feedback = document.getElementById('control-feedback');
  const report = document.getElementById('control-report');
  const apiKeyInput = document.getElementById('api-key');

  if (!feedback || !report || buttons.length === 0) {
    return;
  }

  if (apiKeyInput) {
    const savedKey = window.localStorage.getItem('receipt_api_key');
    if (savedKey) {
      apiKeyInput.value = savedKey;
    }
  }

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');

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

  const clearReport = () => {
    report.innerHTML = '';
    report.classList.add('hidden');
  };

  const renderReport = (status) => {
    if (!status || !Array.isArray(status.statuses)) {
      clearReport();
      return;
    }

    const summaryText = status.ok ? 'Status OK' : 'Status needs attention';
    const summaryClass = status.ok ? 'ok' : 'warn';

    const sections = status.statuses
      .map((section) => {
        const entries = (section.statuses || []).filter((entry) => entry.label !== 'Fixed');
        const items = entries.length
          ? entries
              .map(
                (entry) => `
                <li class="status-item">
                  <span class="status-pill ${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span>
                  <span>${escapeHtml(entry.label)}</span>
                </li>`
              )
              .join('')
          : '<li class="status-item"><span>All clear.</span></li>';
        return `
          <div class="status-section">
            <h3>${escapeHtml(section.className)}</h3>
            <ul class="status-list">
              ${items}
            </ul>
          </div>`;
      })
      .join('');

    report.innerHTML = `
      <div class="status-summary ${summaryClass}">${summaryText}</div>
      ${sections}
    `;
    report.classList.remove('hidden');
  };

  const setBusy = (isBusy) => {
    buttons.forEach((button) => {
      button.disabled = isBusy;
    });
  };

  const commandLabel = (command) => {
    if (command === 'feed') return 'Feed';
    if (command === 'cut') return 'Cut';
    if (command === 'print-status') return 'Print status report';
    return 'Status report';
  };

  const runCommand = async (command) => {
    setBusy(true);
    clearReport();
    setFeedback(`${commandLabel(command)} request sent...`, false);

    try {
      const headers = {};
      const apiKey = getApiKey();
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }

      const endpoint = command === 'print-status' ? '/api/control/status/print' : `/api/control/${command}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers
      });

      if (response.status === 401) {
        setFeedback('API key required for this action.', true);
        return;
      }

      const data = await response.json().catch(() => ({}));
      renderReport(data.status);

      if (data.confirmed) {
        if (command === 'print-status' && data.jobId) {
          setFeedback(`Status report printed as job #${data.jobId}.`, false);
        } else if (command === 'status') {
          setFeedback('Status report received from printer.', false);
        } else {
          setFeedback(`${commandLabel(command)} confirmed by printer.`, false);
        }
        return;
      }

      if (command === 'print-status' && data.jobId) {
        setFeedback(`Status report queued as job #${data.jobId}, but confirmation failed.`, true);
        return;
      }

      setFeedback(data.error || 'Printer did not confirm the command.', true);
    } catch (error) {
      setFeedback('Control request failed. Check network and try again.', true);
    } finally {
      setBusy(false);
    }
  };

  buttons.forEach((button) => {
    const command = button.dataset.command;
    if (!command) {
      return;
    }
    button.addEventListener('click', () => runCommand(command));
  });
})();
