const fs = require('fs');
let content = fs.readFileSync('src/App.vue', 'utf8');

const initStoreCode = `
const initStore = async () => {
  if (!isTauri()) {
    monitoredChannels.value = JSON.parse(localStorage.getItem('avd_monitored_channels') || '[]');
    monitorConfig.value = JSON.parse(localStorage.getItem('avd_monitor_config') || JSON.stringify({
      autoCheckEnabled: true,
      checkIntervalMinutes: 60,
      lastGlobalCheckTime: 0
    }));
    isStoreInitialized.value = true;
    return;
  }

  try {
    const loadStoreItem = async (key, refVar, isJson = false) => {
      const stored = await store.get(key);
      if (stored !== undefined && stored !== null) {
        if (isJson && typeof stored === 'string') {
          refVar.value = JSON.parse(stored);
        } else if (['avd_tv_mode', 'avd_mp3_mode', 'avd_confirm_delete_all', 'avd_confirm_delete_single', 'avd_confirm_clear_all', 'avd_confirm_clear_single', 'avd_test_mode_enabled'].includes(key)) {
          refVar.value = typeof stored === 'string' ? stored === 'true' : !!stored;
        } else {
          refVar.value = stored;
        }
        const strVal = typeof refVar.value === 'string' ? refVar.value : JSON.stringify(refVar.value);
        localStorage.setItem(key, strVal);
      } else {
        const local = localStorage.getItem(key);
        if (local !== null) {
          if (isJson) {
            const parsed = JSON.parse(local);
            refVar.value = parsed;
            await store.set(key, parsed);
          } else if (['avd_tv_mode', 'avd_mp3_mode', 'avd_confirm_delete_all', 'avd_confirm_delete_single', 'avd_confirm_clear_all', 'avd_confirm_clear_single', 'avd_test_mode_enabled'].includes(key)) {
            refVar.value = local === 'true';
            await store.set(key, refVar.value);
          } else {
            refVar.value = local;
            await store.set(key, local);
          }
          await store.save();
        }
      }
    };

    await loadStoreItem('avd_monitored_channels', monitoredChannels, true);
    await loadStoreItem('avd_monitor_config', monitorConfig, true);
    await loadStoreItem('avd_tv_mode', isTvMode, false);
    await loadStoreItem('avd_target_tv_ip', targetTvIp, false);
    await loadStoreItem('avd_mp3_mode', mp3Mode, false);
    await loadStoreItem('avd_wifi_ssid', wifiSsid, false);
    await loadStoreItem('avd_wifi_pwd', wifiPassword, false);
    await loadStoreItem('avd_confirm_delete_all', confirmDeleteAll, false);
    await loadStoreItem('avd_confirm_delete_single', confirmDeleteSingle, false);
    await loadStoreItem('avd_confirm_clear_all', confirmClearAll, false);
    await loadStoreItem('avd_confirm_clear_single', confirmClearSingle, false);
    await loadStoreItem('avd_test_mode_enabled', testModeEnabled, false);
    await loadStoreItem('avd_tasks', tasks, true);
    await loadStoreItem('avd_drive_token', driveToken, false);

  } catch (e) {
    console.error('Failed to init store', e);
  }
  isStoreInitialized.value = true;
};
`;

content = content.replace(/onMounted\(async \(\) => \{/, `${initStoreCode}\nonMounted(async () => {\n  await initStore();\n`);

content = content.replace(/watch\(monitoredChannels, \(val\) => \{[\s\S]*?\}, \{ deep: true \}\);/m, `watch(monitoredChannels, (val) => {
  if (!isStoreInitialized.value) return;
  saveConfig('avd_monitored_channels', val);
}, { deep: true });`);

content = content.replace(/watch\(monitorConfig, \(val\) => \{[\s\S]*?\}, \{ deep: true \}\);/m, `watch(monitorConfig, (val) => {
  if (!isStoreInitialized.value) return;
  saveConfig('avd_monitor_config', val);
}, { deep: true });`);

content = content.replace(/localStorage\.setItem\('avd_tv_mode', String\(isTvMode\.value\)\);/g, "saveConfig('avd_tv_mode', isTvMode.value);");
content = content.replace(/localStorage\.setItem\('avd_target_tv_ip', targetTvIp\.value\);/g, "saveConfig('avd_target_tv_ip', targetTvIp.value);");
content = content.replace(/localStorage\.setItem\('avd_tv_mode', 'true'\);/g, "saveConfig('avd_tv_mode', true);");

content = content.replace(/watch\(confirmDeleteAll, \(val\) => localStorage\.setItem\('avd_confirm_delete_all', String\(val\)\)\);/g, "watch(confirmDeleteAll, (val) => { if (isStoreInitialized.value) saveConfig('avd_confirm_delete_all', val); });");
content = content.replace(/watch\(confirmDeleteSingle, \(val\) => localStorage\.setItem\('avd_confirm_delete_single', String\(val\)\)\);/g, "watch(confirmDeleteSingle, (val) => { if (isStoreInitialized.value) saveConfig('avd_confirm_delete_single', val); });");
content = content.replace(/watch\(confirmClearAll, \(val\) => localStorage\.setItem\('avd_confirm_clear_all', String\(val\)\)\);/g, "watch(confirmClearAll, (val) => { if (isStoreInitialized.value) saveConfig('avd_confirm_clear_all', val); });");
content = content.replace(/watch\(confirmClearSingle, \(val\) => localStorage\.setItem\('avd_confirm_clear_single', String\(val\)\)\);/g, "watch(confirmClearSingle, (val) => { if (isStoreInitialized.value) saveConfig('avd_confirm_clear_single', val); });");
content = content.replace(/watch\(testModeEnabled, \(val\) => localStorage\.setItem\('avd_test_mode_enabled', String\(val\)\)\);/g, "watch(testModeEnabled, (val) => { if (isStoreInitialized.value) saveConfig('avd_test_mode_enabled', val); });");

content = content.replace(/localStorage\.setItem\('avd_wifi_ssid', wifiSsid\.value\);/g, "saveConfig('avd_wifi_ssid', wifiSsid.value);");
content = content.replace(/localStorage\.setItem\('avd_wifi_pwd', wifiPassword\.value\);/g, "saveConfig('avd_wifi_pwd', wifiPassword.value);");
content = content.replace(/localStorage\.setItem\('avd_mp3_mode', String\(newVal\)\);/g, "saveConfig('avd_mp3_mode', newVal);");
content = content.replace(/localStorage\.setItem\('avd_tasks', JSON\.stringify\(newTasks\)\);/g, "saveConfig('avd_tasks', newTasks);");
content = content.replace(/localStorage\.setItem\('avd_drive_token', driveToken\.value\);/g, "saveConfig('avd_drive_token', driveToken.value);");

fs.writeFileSync('src/App.vue', content, 'utf8');
console.log('App.vue patched logic.');
