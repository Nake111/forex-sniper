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

Use Node.js 22.13+ for Expo SDK 58.

```bash
npm install
npx expo-doctor
npx expo start
```

Set `EXPO_PUBLIC_API_BASE_URL` to the deployed mobile gateway URL before connecting live data. The client deliberately does not call the existing protected ChatGPT bridge directly because embedding its shared bearer secret in an APK would expose it.

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
