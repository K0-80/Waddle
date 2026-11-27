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


<h2>todo: </h2>
- launch on startup setting?
- hat cosmetics?
- buy a proper backend  server?
