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

const MAX_EVENTS = 50;
const NOTIFICATION_COOLDOWN = 5000; // 5 seconds between notifications

// Warning dialog for first firewall hit on new network
const NetworkWarningDialog = GObject.registerClass({
    Signals: { 'view-details': {} },
}, class NetworkWarningDialog extends ModalDialog.ModalDialog {
    _init(networkName, event) {
        super._init({ styleClass: 'firewall-warning-dialog' });

        let content = new St.BoxLayout({
            vertical: true,
            style_class: 'firewall-warning-content',
        });

        // Warning icon
        let icon = new St.Icon({
            icon_name: 'dialog-warning-symbolic',
            icon_size: 64,
            style_class: 'firewall-warning-icon',
        });
        content.add_child(icon);

        // Title
        let title = new St.Label({
            text: '⚠️ NETWORK SECURITY WARNING ⚠️',
            style_class: 'firewall-warning-title',
            style: 'font-size: 18pt; font-weight: bold; color: #ff6b6b; margin-top: 20px;',
        });
        content.add_child(title);

        // Message
        let message = new St.Label({
            text: `The network you are connected to is probing your ports!\n\n` +
                `Network: ${networkName}\n` +
                `First attack from: ${event.sourceIP}\n` +
                `Target port: ${event.destPort} (${event.protocol})`,
            style_class: 'firewall-warning-message',
            style: 'font-size: 12pt; margin-top: 20px; text-align: center;',
        });
        content.add_child(message);

        // Info
        let info = new St.Label({
            text: 'Your firewall is protecting you. This is normal on public networks,\n' +
                'but be cautious about what you share on this connection.',
            style_class: 'firewall-warning-info',
            style: 'font-size: 10pt; margin-top: 20px; font-style: italic; color: #888;',
        });
        content.add_child(info);

        this.contentLayout.add_child(content);

        // OK button
        this.addButton({
            label: 'I Understand',
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });

        this.addButton({
            label: 'View Details',
            action: () => {
                this.close();
                // This will be connected to open the main menu
                this.emit('view-details');
            },
        });
    }
});

// Full history dialog
const FirewallHistoryDialog = GObject.registerClass(
    class FirewallHistoryDialog extends ModalDialog.ModalDialog {
        _init(events) {
            super._init({ styleClass: 'firewall-history-dialog' });

            let content = new St.BoxLayout({
                vertical: true,
                style_class: 'firewall-history-content',
            });

            // Title
            let title = new St.Label({
                text: 'Firewall Block History',
                style_class: 'firewall-history-title',
            });
            content.add_child(title);

            // Scrollable list
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
            this._lastNotification = 0;

            // Network monitoring
            this._networkMonitor = Gio.NetworkMonitor.get_default();
            this._settings = extension.getSettings();
            this._currentNetwork = null;
            this._gatewayIP = null;
            this._hasShownWarningForNetwork = false;
            this._networkChangedId = null;

            this._geoipCache = new Map();
            this._soupSession = new Soup.Session();

            // Detect current network
            this._detectNetwork();

            this._box = new St.BoxLayout({
                style_class: 'panel-status-menu-box',
            });

            // Create panel icon
            let icon = new St.Icon({
                icon_name: 'security-high-symbolic',
                style_class: 'system-status-icon',
            });
            this._box.add_child(icon);

            // Create label for event count
            this._label = new St.Label({
                text: '0',
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'firewall-event-count',
            });
            this._box.add_child(this._label);

            this.add_child(this._box);

            // Create popup menu
            this._createMenu();

            // Monitor network changes
            this._networkChangedId = this._networkMonitor.connect('network-changed', () => {
                this._onNetworkChanged();
            });

            // Start monitoring
            this._startMonitoring();
        }

        _detectNetwork() {
            // Get current network identifier and gateway
            try {
                let [success, stdout] = GLib.spawn_command_line_sync('ip route show default');
                if (success) {
                    let output = new TextDecoder().decode(stdout);
                    let ifaceMatch = output.match(/dev\s+(\S+)/);
                    if (ifaceMatch) {
                        this._currentNetwork = ifaceMatch[1];
                    } else {
                        this._currentNetwork = null;
                    }
                    // Extract gateway IP
                    let gwMatch = output.match(/via\s+([^\s]+)/);
                    if (gwMatch) {
                        this._gatewayIP = gwMatch[1];
                        log(`[Firewall Monitor] Detected gateway: ${this._gatewayIP}`);
                    } else {
                        this._gatewayIP = null;
                        log(`[Firewall Monitor] No gateway detected`);
                    }
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
                // Reset warning flag for new network
                this._hasShownWarningForNetwork = false;
            }
        }

        _createMenu() {
            // Header
            let headerItem = new PopupMenu.PopupMenuItem('Firewall Activity', {
                reactive: false,
                can_focus: false,
            });
            headerItem.label.style = 'font-weight: bold;';
            this.menu.addMenuItem(headerItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Events section
            this._eventsSection = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this._eventsSection);

            // No events placeholder
            this._noEventsItem = new PopupMenu.PopupMenuItem('No firewall blocks detected', {
                reactive: false,
                can_focus: false,
            });
            this._noEventsItem.label.style = 'font-style: italic; color: #888;';
            this._eventsSection.addMenuItem(this._noEventsItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // History button
            let historyItem = new PopupMenu.PopupMenuItem('Show Full History');
            historyItem.connect('activate', () => {
                let dialog = new FirewallHistoryDialog(this._events);
                dialog.open();
            });
            this.menu.addMenuItem(historyItem);

            // Clear button
            let clearItem = new PopupMenu.PopupMenuItem('Clear History');
            clearItem.connect('activate', () => this._clearEvents());
            this.menu.addMenuItem(clearItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Notification toggle
            this._notificationSwitch = new PopupMenu.PopupSwitchMenuItem('Notifications',
                this._settings.get_boolean('enable-notifications'));

            this._notificationSwitch.connect('toggled', (item, state) => {
                this._settings.set_boolean('enable-notifications', state);
            });

            // Keep switch in sync with settings
            this._settings.connect('changed::enable-notifications', () => {
                this._notificationSwitch.setToggleState(this._settings.get_boolean('enable-notifications'));
            });

            this.menu.addMenuItem(this._notificationSwitch);
        }

        _startMonitoring() {
            try {
                // Spawn journalctl process to follow kernel logs
                let [success, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
                    null, // working directory
                    ['journalctl', '-k', '-f', '--no-pager', '-o', 'short-iso'],
                    null, // environment
                    GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                    null // child setup
                );

                if (!success) {
                    this._showError('Failed to start log monitoring');
                    return;
                }

                this._pid = pid;

                // Close stdin
                GLib.close(stdin);

                // Create stream for stdout
                let stream = new Gio.DataInputStream({
                    base_stream: new Gio.UnixInputStream({
                        fd: stdout,
                        close_fd: true,
                    }),
                    close_base_stream: true,
                });

                // Read lines asynchronously
                this._readLines(stream);

                // Watch for process exit
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
                        // Continue reading
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
            // Parse UFW log format
            // Example: 2026-02-07T19:21:55+0300 arch kernel: [UFW BLOCK] IN=wlp0s20f3 OUT= MAC=... SRC=202.61.229.140 DST=192.168.0.6 ... PROTO=UDP SPT=17101 DPT=11562 ...

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
                // Extract timestamp
                let timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
                let timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();

                // Extract fields using regex
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

                // Map protocol numbers to names
                if (protocol === '2') protocol = 'IGMP';
                if (protocol === '1') protocol = 'ICMP';
                if (protocol === '6') protocol = 'TCP';
                if (protocol === '17') protocol = 'UDP';

                // Filter out router/gateway pings
                if (this._gatewayIP && sourceIP === this._gatewayIP.trim()) {
                    return null;
                }

                // Filter local discovery (mDNS, IGMP, broadcast, IPv6 link-local, LLMNR)
                if (this._settings.get_boolean('filter-local-discovery')) {
                    const localDiscoveryIPs = [
                        '224.0.0.1', '224.0.0.251', '255.255.255.255',
                        'ff02::1', 'ff02::fb', 'ff02::1:3' // IPv6 Multicast (All nodes, mDNS, LLMNR)
                    ];

                    if (localDiscoveryIPs.includes(destIP)) {
                        return null;
                    }
                    if (protocol === 'IGMP') {
                        return null;
                    }

                    // Filter IPv6 link-local
                    if (sourceIP.startsWith('fe80:')) {
                        return null;
                    }

                    // Filter LLMNR (UDP 5355)
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
                    flag: '🏳️' // Default flag placeholder
                };
            } catch (e) {
                logError(e, 'Error parsing firewall event');
                return null;
            }
        }

        async _fetchGeoIP(event) {
            let ip = event.sourceIP;

            // Skip private IPs
            if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('127.')) {
                return;
            }

            // Check if network is available
            if (!this._networkMonitor.network_available) {
                return;
            }

            if (this._geoipCache.has(ip)) {
                event.flag = this._geoipCache.get(ip);
                this._updateMenu();
                return;
            }

            try {
                let message = Soup.Message.new('GET', `https://ipapi.co/${ip}/json/`);
                this._soupSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
                    try {
                        let bytes = session.send_and_read_finish(res);
                        let data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                        if (data && data.country_code) {
                            let flag = this._countryCodeToEmoji(data.country_code);
                            this._geoipCache.set(ip, flag);
                            event.flag = flag;
                            this._updateMenu();
                        }
                    } catch (e) {
                        // Silently fail for GeoIP
                    }
                });
            } catch (e) {
                // Silently fail
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
            // Add to events array (circular buffer)
            this._events.unshift(event);
            if (this._events.length > MAX_EVENTS) {
                this._events.pop();
            }

            // Check if this is the first hit on a new network
            if (!this._hasShownWarningForNetwork && this._currentNetwork) {
                this._showNetworkWarning(event);
                this._hasShownWarningForNetwork = true;
            }

            // Update UI
            this._updateMenu();
            this._updateLabel();

            // Fetch GeoIP
            this._fetchGeoIP(event);

            // Show notification (with cooldown)
            let now = Date.now();
            if (now - this._lastNotification > NOTIFICATION_COOLDOWN) {
                this._showNotification(event);
                this._lastNotification = now;
            }
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
            // Clear existing items
            this._eventsSection.removeAll();

            if (this._events.length === 0) {
                this._eventsSection.addMenuItem(this._noEventsItem);
                return;
            }

            // Add recent events (show last 10)
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

                // Color code by protocol
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

            // Add "and X more" if there are more events
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

        _showNotification(event) {
            if (!this._settings.get_boolean('enable-notifications')) {
                return;
            }

            let source = new MessageTray.Source({
                title: 'Firewall Monitor',
                icon: new Gio.ThemedIcon({ name: 'security-high-symbolic' }),
            });

            Main.messageTray.add(source);

            let notification = new MessageTray.Notification({
                source: source,
                title: 'Connection Blocked',
                body: `${event.sourceIP} tried to connect to port ${event.destPort} (${event.protocol})`,
                isTransient: true,
            });

            source.addNotification(notification);
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
            // Disconnect network monitor
            if (this._networkChangedId) {
                this._networkMonitor.disconnect(this._networkChangedId);
                this._networkChangedId = null;
            }

            // Kill journalctl process
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
