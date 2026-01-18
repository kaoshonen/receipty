(() => {
  const table = document.getElementById('activity-table');
  const feedback = document.getElementById('activity-feedback');

  if (!table) {
    return;
  }

  const getApiKey = () => {
    const cached = window.localStorage.getItem('receipt_api_key');
    return cached && cached.length > 0 ? cached : null;
  };

  const setFeedback = (message, isError) => {
    if (!feedback) {
      return;
    }
    feedback.textContent = message;
    feedback.classList.remove('hidden');
    if (isError) {
      feedback.classList.add('error');
    } else {
      feedback.classList.remove('error');
    }
  };

  table.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const button = target.closest('button[data-job-id]');
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const jobId = button.dataset.jobId;
    if (!jobId) {
      return;
    }

    const originalLabel = button.textContent || 'Reprint';
    button.disabled = true;
    button.textContent = 'Reprinting...';
    setFeedback(`Reprinting job #${jobId}...`, false);

    try {
      const headers = {};
      const apiKey = getApiKey();
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }
      const response = await fetch(`/api/jobs/${jobId}/reprint`, {
        method: 'POST',
        headers
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback(data.error || 'Reprint failed.', true);
        return;
      }
      setFeedback(`Queued reprint as job #${data.jobId}.`, false);
    } catch (error) {
      setFeedback('Reprint request failed. Check network and try again.', true);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
})();
