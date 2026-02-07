import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class FirewallMonitorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // Get settings
        const settings = this.getSettings();

        // Create a preferences page
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'security-high-symbolic',
        });
        window.add(page);

        // Notifications group
        const notificationGroup = new Adw.PreferencesGroup({
            title: 'Notifications',
            description: 'Configure notification behavior',
        });
        page.add(notificationGroup);

        // Enable notifications switch
        const enableNotificationsRow = new Adw.SwitchRow({
            title: 'Enable Notifications',
            subtitle: 'Show notifications for blocked connections',
        });
        notificationGroup.add(enableNotificationsRow);
        settings.bind(
            'enable-notifications',
            enableNotificationsRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Notification cooldown
        const cooldownRow = new Adw.SpinRow({
            title: 'Notification Cooldown',
            subtitle: 'Minimum seconds between notifications',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 60,
                step_increment: 1,
            }),
        });
        notificationGroup.add(cooldownRow);
        settings.bind(
            'notification-cooldown',
            cooldownRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Display group
        const displayGroup = new Adw.PreferencesGroup({
            title: 'Display',
            description: 'Configure what to display',
        });
        page.add(displayGroup);

        // Max events
        const maxEventsRow = new Adw.SpinRow({
            title: 'Maximum Events',
            subtitle: 'Maximum number of events to keep in history',
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 200,
                step_increment: 10,
            }),
        });
        displayGroup.add(maxEventsRow);
        settings.bind(
            'max-events',
            maxEventsRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Show event count
        const showCountRow = new Adw.SwitchRow({
            title: 'Show Event Count',
            subtitle: 'Display number of blocked events in panel',
        });
        displayGroup.add(showCountRow);
        settings.bind(
            'show-event-count',
            showCountRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Filter group
        const filterGroup = new Adw.PreferencesGroup({
            title: 'Filters',
            description: 'Filter which events to show',
        });
        page.add(filterGroup);

        // Show TCP
        const showTcpRow = new Adw.SwitchRow({
            title: 'Show TCP',
            subtitle: 'Display TCP connection attempts',
        });
        filterGroup.add(showTcpRow);
        settings.bind(
            'show-tcp',
            showTcpRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Show UDP
        const showUdpRow = new Adw.SwitchRow({
            title: 'Show UDP',
            subtitle: 'Display UDP connection attempts',
        });
        filterGroup.add(showUdpRow);
        settings.bind(
            'show-udp',
            showUdpRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Show ICMP
        const showIcmpRow = new Adw.SwitchRow({
            title: 'Show ICMP',
            subtitle: 'Display ICMP packets',
        });
        filterGroup.add(showIcmpRow);
        settings.bind(
            'show-icmp',
            showIcmpRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
    }
}
