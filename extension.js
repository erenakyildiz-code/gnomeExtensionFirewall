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

const FirewallIndicator = GObject.registerClass(
    class FirewallIndicator extends PanelMenu.Button {
        _init(extension) {
            super._init(0.0, 'Firewall Monitor', false);

            this._extension = extension;
            this._events = [];
            this._lastNotification = 0;

            // Network monitoring
            this._networkMonitor = Gio.NetworkMonitor.get_default();
            this._currentNetwork = null;
            this._hasShownWarningForNetwork = false;
            this._networkChangedId = null;

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
            // Get current network identifier (simplified - uses default route)
            try {
                let [success, stdout] = GLib.spawn_command_line_sync('ip route show default');
                if (success) {
                    let output = new TextDecoder().decode(stdout);
                    // Extract interface name as network identifier
                    let match = output.match(/dev\s+(\S+)/);
                    if (match) {
                        this._currentNetwork = match[1];
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

            // Clear button
            let clearItem = new PopupMenu.PopupMenuItem('Clear History');
            clearItem.connect('activate', () => this._clearEvents());
            this.menu.addMenuItem(clearItem);
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

                return {
                    timestamp: timestamp,
                    sourceIP: srcMatch[1],
                    destIP: dstMatch ? dstMatch[1] : 'unknown',
                    protocol: protoMatch[1],
                    sourcePort: sptMatch ? sptMatch[1] : 'N/A',
                    destPort: dptMatch ? dptMatch[1] : 'N/A',
                    interface: inMatch ? inMatch[1] : 'unknown',
                };
            } catch (e) {
                logError(e, 'Error parsing firewall event');
                return null;
            }
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
                let text = `${event.sourceIP}:${event.sourcePort} → :${event.destPort} (${event.protocol})`;
                let item = new PopupMenu.PopupMenuItem(text, {
                    reactive: false,
                    can_focus: false,
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
