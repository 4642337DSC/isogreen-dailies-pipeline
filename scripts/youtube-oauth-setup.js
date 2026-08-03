import http from 'node:http';

// One-time local setup to mint a YouTube Analytics refresh token. Run this
// once on your own machine - it needs a real browser and the channel-owning
// Google account to approve consent, so it can never run in GitHub Actions.
//
// 1. Fill in YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET in your
//    local .env (from the Google Cloud "Web application" OAuth client -
//    redirect URI must be exactly http://localhost:8080/).
// 2. Run this script with that .env loaded, e.g.:
//      node --env-file=.env scripts/youtube-oauth-setup.js
// 3. Open the printed URL, sign in with the channel-owning account, approve.
// 4. Copy the refresh token this prints into YOUTUBE_REFRESH_TOKEN - both in
//    your local .env and as a GitHub Actions secret. Never commit it.

var clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
var clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
var redirectUri = 'http://localhost:8080/';

if (!clientId || !clientSecret) {
  throw new Error('Set YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET first (see .env.example).');
}

var scope = [
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.readonly'
].join(' ');

var authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: scope,
  access_type: 'offline',
  prompt: 'consent' // forces a refresh_token even if this account already approved before
}).toString();

console.log('Open this URL, sign in with the channel-owning Google account, and approve:\n');
console.log(authUrl + '\n');
console.log('Waiting for the redirect to ' + redirectUri + ' ...');

var server = http.createServer(function (req, res) {
  var url = new URL(req.url, redirectUri);
  var code = url.searchParams.get('code');
  if (!code) {
    res.end('No code received - check the terminal and try again.');
    return;
  }
  res.end('Success - you can close this tab and return to the terminal.');
  server.close();

  fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    }).toString()
  })
    .then(function (r) { return r.json(); })
    .then(function (tokenData) {
      if (!tokenData.refresh_token) {
        console.error('\nNo refresh_token in the response - if you have authorized this app before, revoke access at https://myaccount.google.com/permissions and try again.\n', tokenData);
        process.exitCode = 1;
        return;
      }
      console.log('\nYOUTUBE_REFRESH_TOKEN=' + tokenData.refresh_token);
      console.log('\nSave this as a GitHub Actions secret (and in your local .env) - it will not be shown again unless you re-run this script.');
    })
    .catch(function (e) {
      console.error('Token exchange failed: ' + e);
      process.exitCode = 1;
    });
});

server.listen(8080);
