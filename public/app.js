(() => {
  const textarea = document.getElementById('print-text');
  const counter = document.getElementById('char-count');
  const printButton = document.getElementById('print-button');
  const feedback = document.getElementById('print-feedback');
  const statusBadge = document.getElementById('printer-status');
  const lastJob = document.getElementById('last-job');
  const apiKeyInput = document.getElementById('api-key');
  const dropZone = document.getElementById('image-drop');
  const imageInput = document.getElementById('image-input');
  const imagePreview = document.getElementById('image-preview');
  const imagePreviewImg = document.getElementById('image-preview-img');
  const imagePreviewName = document.getElementById('image-preview-name');
  const imageRemove = document.getElementById('image-remove');
  const includeText = document.getElementById('include-text');
  const includeImage = document.getElementById('include-image');

  if (!textarea || !counter || !printButton || !feedback || !statusBadge || !lastJob) {
    return;
  }

  const maxChars = Number.parseInt(textarea.dataset.max || '0', 10);
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/bmp'];
  let selectedImage = null;
  let previewUrl = null;

  if (apiKeyInput) {
    const savedKey = window.localStorage.getItem('receipt_api_key');
    if (savedKey) {
      apiKeyInput.value = savedKey;
    }
  }

  const updateCounter = () => {
    const includeTextChecked = includeText instanceof HTMLInputElement ? includeText.checked : true;
    const length = includeTextChecked ? textarea.value.length : 0;
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

  const setImagePreview = (file) => {
    if (!(imagePreview && imagePreviewImg && imagePreviewName && includeImage instanceof HTMLInputElement)) {
      return;
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    previewUrl = URL.createObjectURL(file);
    imagePreviewImg.src = previewUrl;
    imagePreviewName.textContent = `${file.name} · ${Math.round(file.size / 1024)}KB`;
    imagePreview.classList.remove('hidden');
    includeImage.disabled = false;
    includeImage.checked = true;
  };

  const clearImagePreview = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    if (imagePreviewImg) {
      imagePreviewImg.removeAttribute('src');
    }
    if (imagePreviewName) {
      imagePreviewName.textContent = '';
    }
    if (imagePreview) {
      imagePreview.classList.add('hidden');
    }
    if (imageInput instanceof HTMLInputElement) {
      imageInput.value = '';
    }
    if (includeImage instanceof HTMLInputElement) {
      includeImage.checked = false;
      includeImage.disabled = true;
    }
    selectedImage = null;
  };

  const handleImageFile = (file) => {
    if (!file) {
      clearImagePreview();
      return;
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setFeedback('Unsupported image type. Use PNG, JPEG, GIF, or BMP.', true);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setFeedback('Image is too large. Max size is 2MB.', true);
      return;
    }
    selectedImage = file;
    setImagePreview(file);
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
    const imageNote = job.hasImage
      ? `<p class="image-indicator">Image attached${job.imageMime ? ` (${escapeHtml(job.imageMime)})` : ''}</p>`
      : '';
    lastJob.innerHTML = `
      <div class="result-meta">
        <span class="chip ${escapeHtml(statusClass)}">${escapeHtml(job.status)}</span>
        <span>Job #${escapeHtml(job.id)}</span>
        <span>${escapeHtml(job.createdAt)}</span>
      </div>
      <p class="result-preview">${escapeHtml(job.text || job.preview || '')}</p>
      ${imageNote}
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
    const includeTextChecked = includeText instanceof HTMLInputElement ? includeText.checked : true;
    const includeImageChecked = includeImage instanceof HTMLInputElement ? includeImage.checked : false;
    if (!includeTextChecked && !includeImageChecked) {
      setFeedback('Select text and/or image to print.', true);
      return;
    }
    if (includeTextChecked && !text.trim()) {
      setFeedback('Enter text before printing.', true);
      return;
    }
    if (includeImageChecked && !selectedImage) {
      setFeedback('Select an image before printing.', true);
      return;
    }
    printButton.disabled = true;
    setFeedback('Sending to printer queue...', false);

    try {
      const headers = {};
      const apiKey = getApiKey();
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }
      let response;
      if (includeImageChecked && selectedImage) {
        const formData = new FormData();
        if (includeTextChecked) {
          formData.append('text', text);
        }
        formData.append('image', selectedImage);
        formData.append('includeText', includeTextChecked ? 'true' : 'false');
        formData.append('includeImage', 'true');
        response = await fetch('/api/print', {
          method: 'POST',
          headers,
          body: formData
        });
      } else {
        headers['Content-Type'] = 'application/json';
        response = await fetch('/api/print', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            text: includeTextChecked ? text : '',
            includeText: includeTextChecked,
            includeImage: false
          })
        });
      }
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
  if (includeText instanceof HTMLInputElement) {
    includeText.addEventListener('change', () => {
      textarea.disabled = !includeText.checked;
      updateCounter();
    });
  }
  if (includeImage instanceof HTMLInputElement) {
    includeImage.disabled = true;
  }
  if (dropZone && imageInput instanceof HTMLInputElement) {
    dropZone.addEventListener('click', () => imageInput.click());
    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragover');
      const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
      handleImageFile(file);
    });
  }
  if (imageInput instanceof HTMLInputElement) {
    imageInput.addEventListener('change', () => {
      const file = imageInput.files ? imageInput.files[0] : null;
      handleImageFile(file);
    });
  }
  if (imageRemove) {
    imageRemove.addEventListener('click', () => clearImagePreview());
  }
  clearImagePreview();
  updateCounter();
  refreshStatus();
  setInterval(refreshStatus, 5000);
})();
