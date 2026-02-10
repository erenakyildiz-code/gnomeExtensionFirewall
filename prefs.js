import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class FirewallMonitorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'security-high-symbolic',
        });
        window.add(page);



        const displayGroup = new Adw.PreferencesGroup({
            title: 'Display',
            description: 'Configure what to display',
        });
        page.add(displayGroup);

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

        const filterGroup = new Adw.PreferencesGroup({
            title: 'Filters',
            description: 'Filter which events to show',
        });
        page.add(filterGroup);

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

        const filterLocalDiscoveryRow = new Adw.SwitchRow({
            title: 'Filter Local Discovery',
            subtitle: 'Hide common local network noise (mDNS, IGMP)',
        });
        filterGroup.add(filterLocalDiscoveryRow);
        settings.bind(
            'filter-local-discovery',
            filterLocalDiscoveryRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
    }
}
