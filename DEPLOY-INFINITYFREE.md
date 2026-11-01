# InfinityFree static web preview

InfinityFree can host the exported passenger/driver web client, but it cannot
run this repository's Node.js API or Socket.IO ride-matching service. This is
therefore only a static front end: sign-in, booking, live driver matching, and
trip updates will not work until the API is deployed separately on a Node.js
host. Do not publish this as a working ride service before the API is available.

## Export the web client

On a computer with Node.js installed, from the repository root:

```powershell
npm ci --prefix mobile
npm --prefix mobile run export
```

The finished static site is in `mobile/dist/`. The build automatically includes
`mobile/public/.htaccess` for Apache routing, MIME types, and cache headers.

If a separate HTTPS API is available, set its origin while building so the
client calls that API instead of the InfinityFree website itself:

```powershell
$env:EXPO_PUBLIC_API_URL = "https://api.example.com"
npm --prefix mobile run export
Remove-Item Env:EXPO_PUBLIC_API_URL
```

The API host must allow browser requests from the actual InfinityFree website
origin in its `CORS_ORIGINS` setting and support the app's Socket.IO connection.
Never use a localhost address, LAN address, or temporary tunnel in a public
build.

## Upload

1. Create an InfinityFree account and a website in its control panel. Choose a
   domain or subdomain that the account actually controls.
2. Open File Manager (or FTP) and enter the website's `htdocs` directory.
3. Upload the **contents** of `mobile/dist/` into `htdocs`—including
   `.htaccess`, `_expo/`, `icons/`, `download/`, `index.html`, `manifest.webmanifest`,
   and `sw.js`. Do not upload only the `dist` directory as a nested folder.
4. Open the website's root and `/download/` in a browser. Use the browser console
   to check that the web bundle loads without 404s.

InfinityFree deployment credentials are private: do not paste passwords, FTP
credentials, or account tokens into chat. A static InfinityFree site does not
make the backend or database available and does not provide an uptime or
capacity guarantee. For actual rides, deploy the API on a host that supports
Node.js and persistent storage, then rebuild the web client with that API's
public HTTPS origin.
