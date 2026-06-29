# Unnamed Chrome Bridge

This unpacked Chrome extension connects the local Unnamed app to the Chrome
profile where it is installed. It avoids Chrome remote debugging, so it can use
the profile's normal logged-in websites and cookies.

## Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `chrome-extension/` directory.

Install it in the Chrome profile that has the sessions you want the agent to
use.

## Connect to the local app

1. In the Unnamed web app, sign in normally.
2. Go to **Settings -> Tools -> Chrome Browser** and click **Copy token**.
   If you need to get it manually, run this in the Unnamed app devtools console:

   ```js
   localStorage.getItem('unnamedproject_token')
   ```

3. Open the extension options page.
4. Set **App URL** to `http://localhost:3000`.
5. Paste the token into **App auth token**.
6. Enable **Connect this Chrome profile to Unnamed** and save.

Settings -> Tools -> Chrome Browser should then show **Extension connected**.

## Supported MCP tool surface

The app exposes the existing Chrome MCP tool names through this bridge:

- `browser_tabs`
- `browser_new_tab`
- `browser_navigate`
- `browser_get_text`
- `browser_evaluate`
- `browser_click`
- `browser_fill`
- `browser_screenshot`

The compatibility tool `browser_restart_chrome` now reports extension connection
status instead of restarting Chrome.
