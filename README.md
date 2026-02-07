# Firewall Monitor GNOME Extension

> [!IMPORTANT]
> This project was **vibecoded by Gemini** (Google DeepMind).

A GNOME Shell extension for Arch Linux and other distros that monitors firewall activity (UFW/Audit) in real-time.

## Features
- **Real-time Monitoring**: Follows kernel logs via `journalctl` to detect firewall blocks.
- **Top Panel Indicator**: Displays a shield icon and event count in the status area.
- **Security Warning**: Shows a prominent warning dialog when the first firewall hit occurs on a new network.
- **Detailed History**: View source IP, Target Port, and Protocol for the latest blocked attempts.

## Screens
- **Panel Icon**: A security shield with a live counter.
- **Popup Menu**: Quick view of recent connection attempts color-coded by protocol (TCP/UDP/ICMP).
- **Warning Dialog**: A modal alert for potential network probing.

## Installation

### Dependencies
- Arch Linux (or any system with `journalctl` and `ufw`)
- GNOME Shell 45+

### Manual Setup
1. Clone the repository or copy files to the extension directory:
   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions/firewall-monitor@erenakyildiz-code.github.com
   cp -r * ~/.local/share/gnome-shell/extensions/firewall-monitor@erenakyildiz-code.github.com/
   ```
2. Compile the schema:
   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/firewall-monitor@erenakyildiz-code.github.com/schemas/
   ```
3. Enable the extension:
   ```bash
   gnome-extensions enable firewall-monitor@erenakyildiz-code.github.com
   ```
4. Restart GNOME Shell (or log out and back in) if it doesn't appear immediately.

## License
MIT
