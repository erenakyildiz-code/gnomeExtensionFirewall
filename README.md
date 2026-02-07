# GNOME Firewall Monitor Extension

A GNOME Shell extension that monitors your firewall activity in real-time, showing you every connection attempt blocked by your firewall.

![Security](https://img.shields.io/badge/security-firewall-red)
![GNOME](https://img.shields.io/badge/GNOME-45%2B-blue)
![License](https://img.shields.io/badge/license-GPL--3.0-green)

## Features

- 🔒 **Real-time Monitoring**: See firewall blocks as they happen
- 📊 **Detailed Information**: View source IP, destination port, protocol, and more
- 🔔 **Smart Notifications**: Get notified of connection attempts (with cooldown to avoid spam)
- 🎨 **Color-Coded Display**: TCP, UDP, and ICMP are color-coded for easy identification
- ⚙️ **Configurable**: Customize notifications, filters, and display options
- 📝 **Event History**: Keep track of recent blocked connections

## Screenshots

The extension adds a security icon to your top panel with a count of blocked events. Click it to see detailed information about recent connection attempts.

## Requirements

- GNOME Shell 45 or later
- UFW (Uncomplicated Firewall) or iptables/nftables with logging enabled
- User must be in the `systemd-journal` group to read kernel logs

## Installation

### 1. Add User to systemd-journal Group

To allow the extension to read kernel logs, add your user to the `systemd-journal` group:

```bash
sudo usermod -a -G systemd-journal $USER
```

**Important**: You must log out and log back in for this change to take effect.

### 2. Install the Extension

```bash
# Clone or copy the extension to the GNOME extensions directory
mkdir -p ~/.local/share/gnome-shell/extensions/firewall-monitor@devil.local
cp -r /home/Devil/Desktop/gnomeExtensionFirewall/* ~/.local/share/gnome-shell/extensions/firewall-monitor@devil.local/

# Compile the GSettings schema
cd ~/.local/share/gnome-shell/extensions/firewall-monitor@devil.local
glib-compile-schemas schemas/
```

### 3. Enable the Extension

**For X11:**
```bash
# Restart GNOME Shell
# Press Alt+F2, type 'r', and press Enter

# Enable the extension
gnome-extensions enable firewall-monitor@devil.local
```

**For Wayland:**
```bash
# Log out and log back in

# Enable the extension
gnome-extensions enable firewall-monitor@devil.local
```

## Usage

Once installed and enabled:

1. **Panel Indicator**: Look for the security shield icon in your top panel
2. **Event Count**: The number next to the icon shows how many events have been logged
3. **View Details**: Click the icon to see a list of recent blocked connections
4. **Clear History**: Use the "Clear History" button in the menu to reset the event list
5. **Configure**: Run `gnome-extensions prefs firewall-monitor@devil.local` to customize settings

## Configuration

Access preferences via:
```bash
gnome-extensions prefs firewall-monitor@devil.local
```

Available settings:
- **Enable Notifications**: Toggle desktop notifications on/off
- **Notification Cooldown**: Set minimum time between notifications (1-60 seconds)
- **Maximum Events**: Configure how many events to keep in history (10-200)
- **Show Event Count**: Toggle the event counter in the panel
- **Protocol Filters**: Choose which protocols to display (TCP/UDP/ICMP)

## Firewall Configuration

### UFW (Recommended)

If you're using UFW, logging is typically enabled by default. To verify:

```bash
sudo ufw status verbose
```

To enable logging if it's not already on:

```bash
sudo ufw logging on
```

### iptables/nftables

If you're using raw iptables or nftables, you need to add logging rules. Example for iptables:

```bash
# Log dropped packets
sudo iptables -A INPUT -j LOG --log-prefix "[IPTABLES DROP] " --log-level 4
sudo iptables -A INPUT -j DROP
```

## Troubleshooting

### Extension Not Working

1. **Check if you're in the systemd-journal group**:
   ```bash
   groups | grep systemd-journal
   ```
   If not listed, add yourself and log out/in.

2. **Check GNOME Shell logs**:
   ```bash
   journalctl -f -o cat /usr/bin/gnome-shell
   ```
   Look for errors related to the firewall monitor extension.

3. **Verify firewall logging**:
   ```bash
   journalctl -k -n 50 | grep -i "UFW\|iptables\|nftables"
   ```
   You should see firewall log entries.

### No Events Showing

- Make sure your firewall is actually blocking connections
- Verify logging is enabled in your firewall configuration
- Check that you have the necessary permissions to read kernel logs

### High CPU Usage

If you're experiencing high CPU usage:
- Increase the notification cooldown in preferences
- Reduce the maximum number of events to keep
- Consider filtering out protocols you don't need to monitor

## Uninstallation

```bash
# Disable the extension
gnome-extensions disable firewall-monitor@devil.local

# Remove the extension files
rm -rf ~/.local/share/gnome-shell/extensions/firewall-monitor@devil.local
```

## Development

### File Structure

```
firewall-monitor@devil.local/
├── extension.js          # Main extension code
├── prefs.js             # Preferences UI
├── metadata.json        # Extension metadata
├── stylesheet.css       # Custom styles
├── schemas/
│   └── org.gnome.shell.extensions.firewall-monitor.gschema.xml
└── README.md
```

### Testing

```bash
# Check JavaScript syntax
gjs -c extension.js
gjs -c prefs.js

# Compile schemas
glib-compile-schemas schemas/

# View extension logs
journalctl -f -o cat /usr/bin/gnome-shell | grep -i firewall
```

## Security Considerations

This extension reads kernel logs to monitor firewall activity. It does not:
- Modify firewall rules
- Send data over the network
- Store logs permanently (only keeps recent events in memory)

The extension only displays information that's already available in your system logs.

## License

GPL-3.0

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

## Author

Created for monitoring firewall activity on Arch Linux systems.
