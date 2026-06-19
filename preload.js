const { contextBridge, ipcRenderer } = require('electron');

// Expose a narrow, audited API to the renderer instead of the full ipcRenderer.
// Matches the surface used by renderer/renderer.js:
//   window.sentinel.onProcessUpdate(cb)
//   window.sentinel.diagnoseProcess(info)
//   window.sentinel.killProcess(pid)
contextBridge.exposeInMainWorld('sentinel', {
  onProcessUpdate(callback) {
    const listener = (_event, processes) => callback(processes);
    ipcRenderer.on('process-update', listener);
    // Return an unsubscribe function so the renderer can clean up if it ever needs to.
    return () => ipcRenderer.removeListener('process-update', listener);
  },

  diagnoseProcess(info) {
    return ipcRenderer.invoke('diagnose-process', info);
  },

  killProcess(pid) {
    return ipcRenderer.invoke('kill-process', pid);
  },
});
