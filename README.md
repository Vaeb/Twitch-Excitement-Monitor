# Twitch-Excitement-Monitor
Monitor twitch chat to analyze the moments in a stream when viewers are the most excited.

---

Makes use of the deprecated Twitch NPM package, which may still work. To upgrade to the newer (and simpler) version - https://twurple.js.org/docs/migration/

The `src/auth.json` file, not included in the GitHub repository, uses the following structure:

```json
{
    "clientId": "<twitch account client id>",
    "clientId2": "<old property - can remove>",
    "clientSecret": "<twitch account client secret>",
    "accessToken": "<twitch api access token - set by twitch npm package>",
    "expiryTimestamp": <access token expiry time (number) - set by twitch npm package>,
    "refreshToken": "<twitch api refresh token - set by twitch npm package>",
    "webhook": "<discord webhook url to send alerts>",
    "randomFixedString": "<any random string, e.g. yoze2oa3saetopcjs7z7b205uhjt29>"
}
```

---

Change `channelNames` in `src/twitchSetup.ts` to modify the channels monitored.

Change the following in `src/channels.ts` to modify excitement settings:
- monitorAfterUptime
- statusChangeRealAfter
- windowSeconds
- hypePercentile
- watchStreamDataInterval
- monitorInterval
- windowMs
- storeWithDataSize

Requires creating a MongoDB database, the details for which are in `src/models/`.
