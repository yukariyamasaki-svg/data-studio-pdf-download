const http = require('http');
const { exec } = require('child_process');
const { google } = require('googleapis');
const url = require('url');

const SCOPES = ['https://www.googleapis.com/auth/drive'];
const PORT = 3000;
const CALLBACK_PATH = '/oauth2callback';

function getOAuthClient(clientId, clientSecret) {
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    `http://127.0.0.1:${PORT}${CALLBACK_PATH}`
  );
}

function createAuthUrl(oAuth2Client) {
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
}

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Environment variables GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required.');
    process.exit(1);
  }

  const oAuth2Client = getOAuthClient(clientId, clientSecret);
  const authUrl = createAuthUrl(oAuth2Client);

  console.log('Open this URL in your browser and authorize the app:');
  console.log(authUrl);
  console.log('---');
  console.log('If the browser does not open automatically, copy and paste the URL above into your browser.');
  console.log('---');

  const openBrowser = () => {
    if (process.platform === 'darwin') {
      exec(`open "${authUrl}"`, (err) => {
        if (err) console.log('ブラウザ自動起動に失敗しました。上の URL をコピーしてください。');
      });
    } else if (process.platform === 'win32') {
      exec(`start "" "${authUrl}"`, (err) => {
        if (err) console.log('ブラウザ自動起動に失敗しました。上の URL をコピーしてください。');
      });
    } else {
      exec(`xdg-open "${authUrl}" || true`, (err) => {
        if (err) console.log('ブラウザ自動起動に失敗しました。上の URL をコピーしてください。');
      });
    }
  };

  openBrowser();

  const server = http.createServer(async (req, res) => {
    const reqUrl = url.parse(req.url, true);
    if (reqUrl.pathname !== CALLBACK_PATH) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const code = reqUrl.query.code;
    if (!code) {
      res.writeHead(400);
      res.end('Authorization code is missing.');
      return;
    }

    try {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Authorization complete. You may close this window.\n');

      console.log('\n==== OAuth2 Refresh Token ====>');
      console.log(tokens.refresh_token || 'No refresh token returned.');
      console.log('==== Copy the refresh token above and set it in your environment variable ====>');
      console.log('\nAlso set these environment variables:');
      console.log('  GOOGLE_CLIENT_ID');
      console.log('  GOOGLE_CLIENT_SECRET');
      console.log('  GOOGLE_REFRESH_TOKEN');
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Failed to exchange authorization code.');
      console.error('Error while exchanging code:', error.message);
    } finally {
      server.close();
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\nListening for OAuth2 callback at http://127.0.0.1:${PORT}${CALLBACK_PATH}`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
