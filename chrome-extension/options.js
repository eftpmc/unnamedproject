const appUrl = document.getElementById('appUrl');
const token = document.getElementById('token');
const enabled = document.getElementById('enabled');
const save = document.getElementById('save');
const status = document.getElementById('status');

chrome.storage.sync.get({
  appUrl: 'http://localhost:3000',
  token: '',
  enabled: false,
}, cfg => {
  appUrl.value = cfg.appUrl;
  token.value = cfg.token;
  enabled.checked = Boolean(cfg.enabled);
});

save.addEventListener('click', () => {
  chrome.storage.sync.set({
    appUrl: appUrl.value.trim() || 'http://localhost:3000',
    token: token.value.trim(),
    enabled: enabled.checked,
  }, () => {
    status.textContent = 'Saved';
    setTimeout(() => { status.textContent = ''; }, 1800);
  });
});
