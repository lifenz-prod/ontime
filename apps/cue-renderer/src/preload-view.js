/**
 * Runs in each output's page. It watches the page's own WebSocket to Ontime, reports a heartbeat to
 * the main process every second, and draws the warning overlay when the main process asks for it.
 *
 * The page is sandboxed, so this file cannot require anything of ours: it only talks over IPC.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__ontimeCueRenderer', {
  report: (facts) => ipcRenderer.send('view:heartbeat', facts),
});

const clientNameArgument = process.argv.find((argument) => argument.startsWith('--ontime-client-name='));
const clientName = clientNameArgument ? clientNameArgument.slice('--ontime-client-name='.length) : '';

// Runs in the page's own world, before any of its scripts, so it sees the socket Ontime opens
contextBridge.executeInMainWorld({
  args: [clientName],
  func: (name) => {
    // Ontime reads its client name from here, so the output is recognisable in its client list
    if (name) {
      try {
        localStorage.setItem('ontime-client-name', name);
      } catch {
        // storage can be unavailable, the default name is fine
      }
    }

    const bridge = window.__ontimeCueRenderer;
    const NativeWebSocket = window.WebSocket;
    const pingInterval = 2000;

    let current = null;
    let socketOpen = false;
    let lastMessageAt = 0;

    function isOntimeSocket(url) {
      try {
        return new URL(url, window.location.href).pathname.endsWith('/ws');
      } catch {
        return false;
      }
    }

    class WatchedWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        if (!isOntimeSocket(url)) return;

        // the page only keeps one socket to Ontime: the newest is the one we watch
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        current = this;
        this.addEventListener('open', () => {
          if (current !== this) return;
          socketOpen = true;
          lastMessageAt = Date.now();
        });
        this.addEventListener('message', () => {
          if (current === this) lastMessageAt = Date.now();
        });
        this.addEventListener('close', () => {
          if (current === this) socketOpen = false;
        });
      }
    }
    window.WebSocket = WatchedWebSocket;

    // Views only listen, so a socket that silently died would never notice. Asking for a pong keeps
    // traffic flowing both ways; the page already handles the reply
    setInterval(() => {
      if (current && current.readyState === NativeWebSocket.OPEN) {
        current.send(JSON.stringify({ type: 'ping', payload: new Date() }));
      }
    }, pingInterval);

    // An off-screen page only hands over a frame when something on it changes, and a cue screen can sit
    // still for minutes. Flickering one practically invisible pixel gives a fresh frame every second,
    // which keeps Syphon fed and proves the page is still drawing
    let pulse = null;
    let pulseOn = false;

    setInterval(() => {
      if (!pulse?.isConnected) {
        pulse = document.createElement('div');
        pulse.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;z-index:2147483647';
        document.documentElement.appendChild(pulse);
      }
      pulseOn = !pulseOn;
      pulse.style.background = pulseOn ? 'rgba(0,0,0,0.01)' : 'rgba(0,0,0,0.02)';

      const root = document.getElementById('root');
      bridge.report({
        socketOpen,
        lastMessageAt,
        rootEmpty: !root || root.childElementCount === 0,
      });
    }, 1000);

    window.__ontimeCueRendererControl = {
      kickSocket: () => {
        // closing makes the page's own reconnect logic open a fresh socket
        if (current) current.close();
      },
      setOverlay: (message) => {
        let overlay = document.getElementById('ontime-cue-renderer-overlay');
        if (!message) {
          overlay?.remove();
          return;
        }
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'ontime-cue-renderer-overlay';
          overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:2147483647',
            'display:flex',
            // centred, because cue screen layouts keep their timers along the top
            'align-items:center',
            'justify-content:center',
            'background:rgba(0,0,0,0.55)',
            'pointer-events:none',
          ].join(';');
          const banner = document.createElement('div');
          banner.style.cssText = [
            'padding:1.2vh 3vw',
            'border-radius:1vh',
            'background:#c62828',
            'color:#fff',
            'font:700 4.5vh/1.2 system-ui,sans-serif',
            'text-align:center',
            'letter-spacing:0.02em',
          ].join(';');
          overlay.appendChild(banner);
          document.documentElement.appendChild(overlay);
        }
        overlay.firstChild.textContent = message;
      },
    };
  },
});

ipcRenderer.on('view:command', (_event, command, argument) => {
  contextBridge.executeInMainWorld({
    func: (name, value) => {
      const control = window.__ontimeCueRendererControl;
      if (name === 'kick-socket') control?.kickSocket();
      if (name === 'overlay') control?.setOverlay(value);
    },
    args: [command, argument ?? null],
  });
});
