# Forex Sniper AI — Android app

This is the native Android client for the existing Forex Sniper paper/research engine.

## Safety and architecture

- Android client only talks to a dedicated mobile API gateway over HTTPS.
- The app must never contain GitHub tokens, Railway service secrets, provider API keys, or the existing ChatGPT bridge bearer secret.
- The mobile gateway is responsible for authentication, rate limiting, dispatching analysis, polling the exact run ID, and returning the fail-closed published snapshot.
- A signal is displayed as BUY or SELL only when the server confirms explicit paper approval, current analysis-cycle identity, fresh provider-timestamped bid/ask, quote validation, watchdog health and all existing risk gates.
- Otherwise show NO APPROVED TRADE and the exact blockers. Never invent prices or promote candidates/HOLD into approvals.
- PAPER_RESEARCH_ONLY. No broker integration, trading orders or execution permissions.

## Development

Use Node.js 22.13+ and Java 17 for Expo SDK 58. The repository workflow builds a sideloadable debug APK automatically when mobile files change on the android-app branch.

```bash
npm install
npx expo-doctor
npx expo start
```

The app uses the existing protected Railway bridge URL. Enter the bridge access key in the app on your phone; it is not embedded in the APK. The key is held only in app memory and must be entered again after restarting the app.\n\nThe existing Railway bridge requires two server-side variables: `CHATGPT_ACTION_SECRET` and `GITHUB_ACTIONS_TOKEN`. The Railway service inspection currently shows neither variable configured. Add them in Railway → forex-sniper-live-feed → forex-sniper-chat-action-bridge → Variables. Set the first to your private bridge key and the second to a GitHub token with Actions read/write and repository contents read access. Do not send either secret in chat or commit it to GitHub. Until those variables are configured, the bridge will return HTTP 503 and the app cannot retrieve or run signals.

## Android builds

```bash
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform android --profile production
```

Preview produces an installable APK. Production produces an Android App Bundle (AAB) for Google Play. First configure an Expo EAS project and replace the placeholder project ID in app.json.

## Release checklist

- Implement and deploy the dedicated mobile API gateway.
- Add secure user authentication and device session handling.
- Verify the gateway dispatches a new analysis and polls that exact run before returning results.
- Test all three markets, stale-data behavior, missing-provider behavior, blocked trades and approved paper plans.
- Add privacy policy, data safety disclosures, financial-feature declarations, app icon, screenshots and store listing.
- Complete Google Play's required closed test for new personal developer accounts before applying for production access.
