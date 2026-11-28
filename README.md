<h1>
<img width="64" height="64" alt="Waddle goose icon" src="https://github.com/user-attachments/assets/53e098b5-512e-4e4e-b956-6b3dc6f16d9b" />
   &nbsp;Waddle
</h1>

Waddle is a tiny goose that lives on your desktop while you study. Enter a room code to have your goose  interact with other *friendly* Waddlers in real time. Works on Windows, Mac AND linux.

<table>
  <tr>
    <td width="58%" valign="middle">
      <h2>How it works</h2>
      <p>Waddle is a desktop app built with <strong>Tauri 2</strong>, <strong>Rust</strong>, <strong>TypeScript</strong>, and <strong>Vite</strong>. Tauri packages the web interface as a native app, while Rust handles native window behavior such as the transparent, interactive desktop overlay.</p>
      <p>The TypeScript frontend draws and animates the geese on a canvas, and handles their interactions, menus, and settings. Sprite sheets and sound effects bring the geese to life.</p>
       <p><strong>Supabase</strong> provides email sign-in and stores user profiles and settings. For multiplayer, <strong>Trystero</strong> discovers room members and connects them directly with WebRTC backed by <strong>Metered</strong> TURN servers when direct peer-to-peer connections are blocked. This way goose movement and actions are shared in real time.</p>
    </td>
    <td width="42%" align="center" valign="middle">
      <img width="100%" alt="Waddle running on a desktop" src="https://github.com/user-attachments/assets/e2eec25a-7b4a-47db-8eb0-23b7ec84df46" />
    </td>
  </tr>
</table>

## Download
 
[![Latest Release](https://img.shields.io/github/v/release/K0-80/Waddle?label=latest%20release)](https://github.com/K0-80/Waddle/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/K0-80/Waddle/total?label=downloads)](https://github.com/K0-80/Waddle/releases)
[![Stars](https://img.shields.io/github/stars/K0-80/Waddle?label=stars)](https://github.com/K0-80/Waddle/stargazers)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-blue) 

Grab the installer for your system from the [latest release](https://github.com/K0-80/Waddle/releases/latest):
 
| Platform | Installer |
| --- | --- |
| Windows | `.exe` (setup)|
| macOS | `.dmg` |
| Linux | `.AppImage` |

## Security Warnings on First Launch
 
Waddle is an independent indie app without an Apple Developer certificate or a code-signing certificate, so macOS and Windows may block it the first time you open it. The app is safe to run, and the steps below let you allow it.
 
| Platform | Problem | Fix |
| --- | --- | --- |
| **macOS** | Warning popup on first launch | 1. Open **Waddle** once, then click **Done**.<br>2. Open **System Settings** → **Privacy & Security**.<br>3. Scroll to the **Security** section and click **Open Anyway** next to Waddle.<br>4. Confirm with your password or Touch ID, then click **Open**. |
| **Windows** | Blue SmartScreen popup | 1. Click **More info**.<br>2. Click **Run anyway**. |
| **Windows** | Defender removed the file | 1. Open **Windows Security** → **Virus & threat protection** → **Protection history**.<br>2. Click the blocked item for Waddle.<br>3. Choose **Actions** → **Restore** (or **Allow on device**). |


## To Do
 
- [ ] Launch on startup setting
- [ ] Hat cosmetics
- [ ] Upgrade to a proper backend server

