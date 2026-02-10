import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import Soup from 'gi://Soup?version=3.0';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';




const NetworkWarningDialog = GObject.registerClass({
    Signals: { 'view-details': {} },
}, class NetworkWarningDialog extends ModalDialog.ModalDialog {
    _init(networkName, event) {
        super._init({ styleClass: 'firewall-warning-dialog' });

        let content = new St.BoxLayout({
            vertical: true,
            style_class: 'firewall-warning-content',
        });

        let icon = new St.Icon({
            icon_name: 'dialog-warning-symbolic',
            icon_size: 64,
            style_class: 'firewall-warning-icon',
        });
        content.add_child(icon);

        let title = new St.Label({
            text: '⚠️ NETWORK SECURITY WARNING ⚠️',
            style_class: 'firewall-warning-title',
            style: 'font-size: 18pt; font-weight: bold; color: #ff6b6b; margin-top: 20px;',
        });
        content.add_child(title);

        let message = new St.Label({
            text: `The network you are connected to is probing your ports!\n\n` +
                `Network: ${networkName}\n` +
                `First attack from: ${event.sourceIP}\n` +
                `Target port: ${event.destPort} (${event.protocol})`,
            style_class: 'firewall-warning-message',
            style: 'font-size: 12pt; margin-top: 20px; text-align: center;',
        });
        content.add_child(message);

        let info = new St.Label({
            text: 'Your firewall is protecting you. This is normal on public networks,\n' +
                'but be cautious about what you share on this connection.',
            style_class: 'firewall-warning-info',
            style: 'font-size: 10pt; margin-top: 20px; font-style: italic; color: #888;',
        });
        content.add_child(info);

        this.contentLayout.add_child(content);

        this.addButton({
            label: 'I Understand',
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });

        this.addButton({
            label: 'View Details',
            action: () => {
                this.close();
                this.emit('view-details');
            },
        });
    }
});

const FirewallHistoryDialog = GObject.registerClass(
    class FirewallHistoryDialog extends ModalDialog.ModalDialog {
        _init(events) {
            super._init({ styleClass: 'firewall-history-dialog' });

            let content = new St.BoxLayout({
                vertical: true,
                style_class: 'firewall-history-content',
            });

            let title = new St.Label({
                text: 'Firewall Block History',
                style_class: 'firewall-history-title',
            });
            content.add_child(title);

            let scroll = new St.ScrollView({
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                style_class: 'firewall-history-scroll',
            });

            let list = new St.BoxLayout({
                vertical: true,
                style_class: 'firewall-history-list',
            });

            events.forEach(event => {
                let row = new St.BoxLayout({
                    style_class: 'firewall-history-row',
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                });

                let flag = new St.Label({
                    text: event.flag || '🏳️',
                    style_class: 'firewall-history-flag'
                });
                row.add_child(flag);

                let time = new St.Label({
                    text: event.timestamp.split('T')[1].substring(0, 8),
                    style_class: 'firewall-history-time'
                });
                row.add_child(time);

                let ip = new St.Label({
                    text: event.sourceIP,
                    style_class: 'firewall-history-ip'
                });
                row.add_child(ip);

                let port = new St.Label({
                    text: `:${event.destPort}`,
                    style_class: 'firewall-history-port'
                });
                row.add_child(port);

                let proto = new St.Label({
                    text: `(${event.protocol})`,
                    style_class: 'firewall-history-proto'
                });
                row.add_child(proto);

                row.connect('button-press-event', () => {
                    let text = `${event.sourceIP}:${event.destPort}`;
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                    Main.notify('Copied to clipboard', text);
                    return Clutter.EVENT_STOP;
                });

                list.add_child(row);
            });

            if (events.length === 0) {
                let emptyLabel = new St.Label({
                    text: 'No events in history',
                    style_class: 'firewall-history-empty'
                });
                list.add_child(emptyLabel);
            }

            scroll.set_child(list);
            content.add_child(scroll);

            this.contentLayout.add_child(content);

            this.addButton({
                label: 'Close',
                action: () => this.close(),
                key: Clutter.KEY_Escape,
            });
        }
    });

const FirewallIndicator = GObject.registerClass(
    class FirewallIndicator extends PanelMenu.Button {
        _init(extension) {
            super._init(0.0, 'Firewall Monitor', false);

            this._extension = extension;
            this._events = [];


            this._networkMonitor = Gio.NetworkMonitor.get_default();
            this._settings = extension.getSettings();
            this._currentNetwork = null;
            this._gatewayIP = null;
            this._localIPs = new Set();
            this._recentBlocks = new Map();
            this._networkChangedId = null;

            this._geoipCache = new Map();
            this._soupSession = new Soup.Session();

            this._detectNetwork();

            this._box = new St.BoxLayout({
                style_class: 'panel-status-menu-box',
            });

            let icon = new St.Icon({
                icon_name: 'security-high-symbolic',
                style_class: 'system-status-icon',
            });
            this._box.add_child(icon);

            this._label = new St.Label({
                text: '0',
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'firewall-event-count',
            });
            this._box.add_child(this._label);

            this.add_child(this._box);

            this._createMenu();

            this._networkChangedId = this._networkMonitor.connect('network-changed', () => {
                this._onNetworkChanged();
            });

            this._startMonitoring();
        }

        _detectNetwork() {
            try {
                // Get default gateway and interface
                let [success, stdout] = GLib.spawn_command_line_sync('ip route show default');
                if (success) {
                    let output = new TextDecoder().decode(stdout);
                    let ifaceMatch = output.match(/dev\s+(\S+)/);
                    if (ifaceMatch) {
                        this._currentNetwork = ifaceMatch[1];
                    } else {
                        this._currentNetwork = null;
                    }
                    let gwMatch = output.match(/via\s+([^\s]+)/);
                    if (gwMatch) {
                        this._gatewayIP = gwMatch[1];
                        log(`[Firewall Monitor] Detected gateway: ${this._gatewayIP}`);
                    } else {
                        this._gatewayIP = null;
                        log(`[Firewall Monitor] No gateway detected`);
                    }
                }

                // Get all local IP addresses using 'ip addr'
                this._localIPs.clear();
                let [ipSuccess, ipStdout] = GLib.spawn_command_line_sync('ip addr');
                if (ipSuccess) {
                    let ipOutput = new TextDecoder().decode(ipStdout);
                    // Match inet (IPv4) and inet6 (IPv6) addresses
                    // Regex looks for 'inet <ip>/<mask>' or 'inet6 <ip>/<mask>'
                    let regex = /inet6?\s+([^\/\s]+)/g;
                    let match;
                    while ((match = regex.exec(ipOutput)) !== null) {
                        if (match[1] !== '127.0.0.1' && match[1] !== '::1') {
                            this._localIPs.add(match[1]);
                        }
                    }
                    log(`[Firewall Monitor] Detected local IPs: ${Array.from(this._localIPs).join(', ')}`);
                }
            } catch (e) {
                logError(e, 'Error detecting network');
            }
        }

        _onNetworkChanged() {
            log('[Firewall Monitor] Network changed detected');
            let oldNetwork = this._currentNetwork;
            this._detectNetwork();

            if (oldNetwork !== this._currentNetwork) {
                log(`[Firewall Monitor] Switched from ${oldNetwork} to ${this._currentNetwork}`);
                this._recentBlocks.clear();
            }
        }

        _createMenu() {
            let headerItem = new PopupMenu.PopupMenuItem('Firewall Activity', {
                reactive: false,
                can_focus: false,
            });
            headerItem.label.style = 'font-weight: bold;';
            this.menu.addMenuItem(headerItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._eventsSection = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this._eventsSection);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            let historyItem = new PopupMenu.PopupMenuItem('Show Full History');
            historyItem.connect('activate', () => {
                let dialog = new FirewallHistoryDialog(this._events);
                dialog.open();
            });
            this.menu.addMenuItem(historyItem);

            let clearItem = new PopupMenu.PopupMenuItem('Clear History');
            clearItem.connect('activate', () => this._clearEvents());
            this.menu.addMenuItem(clearItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());


        }

        _startMonitoring() {
            try {
                let [success, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
                    null,
                    ['journalctl', '-k', '-f', '--no-pager', '-o', 'short-iso'],
                    null,
                    GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                    null
                );

                if (!success) {
                    this._showError('Failed to start log monitoring');
                    return;
                }

                this._pid = pid;

                GLib.close(stdin);

                let stream = new Gio.DataInputStream({
                    base_stream: new Gio.UnixInputStream({
                        fd: stdout,
                        close_fd: true,
                    }),
                    close_base_stream: true,
                });

                this._readLines(stream);

                GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, () => {
                    this._pid = null;
                });

            } catch (e) {
                this._showError(`Error starting monitor: ${e.message}`);
            }
        }

        _readLines(stream) {
            stream.read_line_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
                try {
                    let [line] = source.read_line_finish_utf8(result);

                    if (line !== null) {
                        this._processLogLine(line);
                        this._readLines(source);
                    }
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        logError(e, 'Error reading log line');
                    }
                }
            });
        }

        _processLogLine(line) {
            if (!line.includes('[UFW BLOCK]') && !line.includes('[UFW AUDIT]')) {
                return;
            }

            let event = this._parseFirewallEvent(line);
            if (event) {
                this._addEvent(event);
            }
        }

        _parseFirewallEvent(line) {
            try {
                let timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
                let timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();

                let srcMatch = line.match(/SRC=([^\s]+)/);
                let dstMatch = line.match(/DST=([^\s]+)/);
                let protoMatch = line.match(/PROTO=([^\s]+)/);
                let sptMatch = line.match(/SPT=([^\s]+)/);
                let dptMatch = line.match(/DPT=([^\s]+)/);
                let inMatch = line.match(/IN=([^\s]+)/);

                if (!srcMatch || !protoMatch) {
                    return null;
                }

                let sourceIP = srcMatch[1];
                let destIP = dstMatch ? dstMatch[1] : 'unknown';
                let protocol = protoMatch[1];

                if (protocol === '2') protocol = 'IGMP';
                if (protocol === '1') protocol = 'ICMP';
                if (protocol === '6') protocol = 'TCP';
                if (protocol === '17') protocol = 'UDP';

                if (this._gatewayIP && sourceIP === this._gatewayIP.trim()) {
                    return null;
                }

                if (this._localIPs && this._localIPs.has(sourceIP)) {
                    return null;
                }

                if (this._settings.get_boolean('filter-local-discovery')) {
                    const localDiscoveryIPs = [
                        '224.0.0.1', '224.0.0.251', '255.255.255.255',
                        'ff02::1', 'ff02::fb', 'ff02::1:3'
                    ];

                    if (localDiscoveryIPs.includes(destIP)) {
                        return null;
                    }
                    if (protocol === 'IGMP') {
                        return null;
                    }

                    if (sourceIP.startsWith('fe80:')) {
                        return null;
                    }

                    if (protocol === 'UDP' && dptMatch && dptMatch[1] === '5355') {
                        return null;
                    }
                }

                return {
                    timestamp: timestamp,
                    sourceIP: sourceIP,
                    destIP: destIP,
                    protocol: protocol,
                    sourcePort: sptMatch ? sptMatch[1] : 'N/A',
                    destPort: dptMatch ? dptMatch[1] : 'N/A',
                    interface: inMatch ? inMatch[1] : 'unknown',
                    flag: '🏳️'
                };
            } catch (e) {
                logError(e, 'Error parsing firewall event');
                return null;
            }
        }

        async _fetchGeoIP(event) {
            let ip = event.sourceIP;

            if (ip.startsWith('192.168.') || ip.startsWith('10.') ||
                ip.startsWith('127.') || ip.startsWith('172.1') ||
                ip.startsWith('169.254.') || ip.startsWith('fe80:')) {
                return;
            }

            if (!this._networkMonitor.network_available) {
                return;
            }

            if (this._geoipCache.has(ip)) {
                let cached = this._geoipCache.get(ip);
                if (cached) {
                    event.flag = cached;
                    this._updateMenu();
                }
                return;
            }

            this._tryFetchIpApiCo(event, ip);
        }

        _tryFetchIpApiCo(event, ip) {
            try {
                let url = `https://ipapi.co/${ip}/json/`;
                let message = Soup.Message.new('GET', url);
                message.get_request_headers().append('User-Agent', 'FirewallMonitorExtension/1.0 (GNOME Shell Extension)');

                this._soupSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
                    try {
                        let bytes = session.send_and_read_finish(res);
                        let responseCode = message.get_status();

                        if (responseCode !== 200) {
                            log(`[Firewall Monitor] ipapi.co failed (status ${responseCode}), trying fallback...`);
                            this._tryFetchIpApiCom(event, ip);
                            return;
                        }

                        let data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                        if (data && data.country_code) {
                            let flag = this._countryCodeToEmoji(data.country_code);
                            this._geoipCache.set(ip, flag);
                            event.flag = flag;
                            this._updateMenu();
                        } else {
                            this._tryFetchIpApiCom(event, ip);
                        }
                    } catch (e) {
                        log(`[Firewall Monitor] ipapi.co parse error, trying fallback: ${e.message}`);
                        this._tryFetchIpApiCom(event, ip);
                    }
                });
            } catch (e) {
                this._tryFetchIpApiCom(event, ip);
            }
        }

        _tryFetchIpApiCom(event, ip) {
            try {
                let url = `http://ip-api.com/json/${ip}`;
                let message = Soup.Message.new('GET', url);
                message.get_request_headers().append('User-Agent', 'FirewallMonitorExtension/1.0 (GNOME Shell Extension)');

                this._soupSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
                    try {
                        let bytes = session.send_and_read_finish(res);
                        let data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                        if (data && data.status === 'success' && data.countryCode) {
                            let flag = this._countryCodeToEmoji(data.countryCode);
                            this._geoipCache.set(ip, flag);
                            event.flag = flag;
                            this._updateMenu();
                        } else {
                            log(`[Firewall Monitor] Fallback GeoIP failed for ${ip}`);
                            this._geoipCache.set(ip, null);
                        }
                    } catch (e) {
                        log(`[Firewall Monitor] Fallback GeoIP error: ${e.message}`);
                        this._geoipCache.set(ip, null);
                    }
                });
            } catch (e) {
                log(`[Firewall Monitor] Fallback GeoIP failed to send: ${e.message}`);
            }
        }

        _countryCodeToEmoji(countryCode) {
            return countryCode
                .toUpperCase()
                .replace(/./g, char =>
                    String.fromCodePoint(char.charCodeAt(0) + 127397)
                );
        }

        _addEvent(event) {
            this._events.unshift(event);

            // Check warning threshold: 4 blocks in 2 seconds from same IP
            let now = Date.now();
            let sourceIP = event.sourceIP;

            if (!this._recentBlocks.has(sourceIP)) {
                this._recentBlocks.set(sourceIP, []);
            }

            let timestamps = this._recentBlocks.get(sourceIP);
            timestamps.push(now);

            // Keep only timestamps within last 2 seconds (2000 ms)
            timestamps = timestamps.filter(t => now - t <= 2000);
            this._recentBlocks.set(sourceIP, timestamps);

            // If we hit 4 blocks in 2 seconds, warn and reset
            if (timestamps.length >= 4) {
                this._showNetworkWarning(event);
                // Reset to avoid immediate re-trigger on 5th block
                this._recentBlocks.set(sourceIP, []);
            }

            this._updateMenu();
            this._updateLabel();

            this._fetchGeoIP(event);
        }

        _showNetworkWarning(event) {
            let networkName = this._currentNetwork || 'Unknown Network';
            let dialog = new NetworkWarningDialog(networkName, event);

            dialog.connect('view-details', () => {
                this.menu.open();
            });

            dialog.open();
        }

        _updateMenu() {
            this._eventsSection.removeAll();

            if (this._events.length === 0) {
                let noEventsItem = new PopupMenu.PopupMenuItem('No firewall blocks detected', {
                    reactive: false,
                    can_focus: false,
                });
                noEventsItem.label.style = 'font-style: italic; color: #888;';
                this._eventsSection.addMenuItem(noEventsItem);
                return;
            }

            let eventsToShow = this._events.slice(0, 10);
            eventsToShow.forEach(event => {
                let flag = event.flag || '🏳️';
                let portText = event.destPort !== 'N/A' ? `:${event.destPort}` : '';
                let text = `${flag} ${event.sourceIP} → ${portText} (${event.protocol})`;
                let item = new PopupMenu.PopupMenuItem(text);

                item.connect('activate', () => {
                    let copyText = `${event.sourceIP}:${event.destPort}`;
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, copyText);
                    Main.notify('Copied to clipboard', copyText);
                });

                let color = '#ffffff';
                if (event.protocol === 'TCP') {
                    color = '#ff6b6b';
                } else if (event.protocol === 'UDP') {
                    color = '#4ecdc4';
                } else if (event.protocol === 'ICMP') {
                    color = '#ffe66d';
                }

                item.label.style = `color: ${color};`;
                this._eventsSection.addMenuItem(item);
            });

            if (this._events.length > 10) {
                let moreItem = new PopupMenu.PopupMenuItem(
                    `... and ${this._events.length - 10} more`,
                    { reactive: false, can_focus: false }
                );
                moreItem.label.style = 'font-style: italic; color: #888;';
                this._eventsSection.addMenuItem(moreItem);
            }
        }

        _updateLabel() {
            this._label.text = this._events.length.toString();
        }



        _showError(message) {
            log(`[Firewall Monitor] ${message}`);

            let source = new MessageTray.Source({
                title: 'Firewall Monitor',
                icon: new Gio.ThemedIcon({ name: 'dialog-error-symbolic' }),
            });

            Main.messageTray.add(source);

            let notification = new MessageTray.Notification({
                source: source,
                title: 'Error',
                body: message,
                isTransient: false,
            });

            source.addNotification(notification);
        }

        _clearEvents() {
            this._events = [];
            this._updateMenu();
            this._updateLabel();
        }

        destroy() {
            if (this._networkChangedId) {
                this._networkMonitor.disconnect(this._networkChangedId);
                this._networkChangedId = null;
            }

            if (this._pid) {
                try {
                    GLib.spawn_command_line_sync(`kill ${this._pid}`);
                } catch (e) {
                    logError(e, 'Error killing journalctl process');
                }
                this._pid = null;
            }

            super.destroy();
        }
    });

export default class FirewallMonitorExtension extends Extension {
    enable() {
        this._indicator = new FirewallIndicator(this);
        Main.panel.addToStatusArea('firewall-monitor', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
