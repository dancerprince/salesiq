/**
 * backup.js — Backup & Restore functionality
 * Downloads/uploads a JSON file with all user accounts and per-user data.
 */

async function exportBackup() {
  try {
    const data = await DB.exportAll();
    data._localStorage = {};
    if (CURRENT_USER) {
      const uid = CURRENT_USER.id;
      ['agt_tracker_v6_daily', 'agt_tracker_agents', 'agt_tracker_agent_map',
       'agt_tracker_api_config', 'agt_tracker_api_tokens', 'agt_tracker_update_logs'
      ].forEach(base => {
        const key = base + '_' + uid;
        const val = localStorage.getItem(key);
        if (val) data._localStorage[key] = val;
      });
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agent-tracker-backup-' + getTodayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(ic('check', 'icon-sm') + ' Backup downloaded!');
  } catch (e) {
    toast(ic('warn', 'icon-sm') + ' Backup failed: ' + e.message, '#f87171');
  }
}

async function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!confirm('Import data from backup? Existing data for imported users may be overwritten.')) {
    event.target.value = '';
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const result = await DB.importAll(data);
    // Also restore localStorage entries
    if (data._localStorage) {
      Object.entries(data._localStorage).forEach(([k, v]) => {
        try { localStorage.setItem(k, v); } catch (e) { /* ignore */ }
      });
    }
    toast(ic('check', 'icon-sm') + ' Restored! ' + result.usersImported + ' users, ' + result.dataRecords + ' data records');
    // Reload the current session
    const session = await DB.getSession();
    if (session) {
      CURRENT_USER = session;
      await enterApp();
    }
  } catch (e) {
    toast(ic('warn', 'icon-sm') + ' Restore failed: ' + e.message, '#f87171');
  }
  event.target.value = '';
}
