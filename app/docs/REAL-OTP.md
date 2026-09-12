# Signing in from anywhere, with real OTPs

Two separate problems, and they are worth keeping separate because one is five
minutes and the other depends on a regulator.

| | Problem | Answer | Effort |
|---|---|---|---|
| 1 | The app only works on your machine | `npm run share` | one command |
| 2 | The OTP is always `000000` | configure an SMS gateway | 15 min, or weeks — read §2 |

---

## 1. Reachable from anywhere

```bash
cd app
npm start          # in one terminal
npm run share      # in another
```

That prints a public `https://….trycloudflare.com` URL. Open it on any phone,
on mobile data, anywhere. No account, no config, no cost; the URL is random and
lives as long as the command runs.

**HTTPS is the point, not just reachability.** A phone browser withholds
geolocation, service-worker registration and "Add to home screen" over plain
HTTP — so a phone hitting `http://<your-lan-ip>:4000` gets an app that cannot
find you, cannot work offline and cannot install. All three are core here.

`TRUST_PROXY=127.0.0.1,::1` is already set in `.env`, which is what you want:
cloudflared connects from localhost, so the real client IP arrives in
`X-Forwarded-For` and the per-IP OTP ceiling keeps working per visitor instead
of collapsing into one bucket the whole room shares.

### The Android app

It defaults to `http://10.0.2.2:4000`, the emulator's alias for your PC. On a
real handset, open the app and put the tunnel URL in **API base URL** on the
sign-in screen. Use the `https://` one — the manifest permits cleartext for
local development, but the tunnel gives you TLS and the OS prefers it.

---

## 2. Real OTPs

### What changed, so you don't go looking for a flag

The code used to be random only when `NODE_ENV=production`. That coupled two
unrelated things and made this exact task impossible: configuring a gateway in
development sent a real SMS containing the literal string `000000`, and turning
on production mode is refused by `assertProductionSafe` unless you also have
live Razorpay keys, a non-development database, CORS origins and a telecom
webhook secret. Nobody should need a payment gateway to test a login.

Now it follows delivery, which is the thing that actually matters:

| `SMS_PROVIDER` | Code | Returned in the API response? |
|---|---|---|
| `console` (default) | `DEV_OTP`, fixed | Yes, if `EXPOSE_DEV_OTP=true` |
| `twilio` / `msg91` | cryptographically random | **Never**, whatever `EXPOSE_DEV_OTP` says |

That second row is not a courtesy. Echoing a code that reached a handset
publishes the credential to anyone who can call the endpoint — and once you run
`npm run share`, that is the internet. `domain/otp-policy.ts` holds the rule and
`otp-policy.test.ts` asserts the two can never both be true.

### The fast path: Twilio trial to your own phone

Works today, free, about fifteen minutes. A trial account sends only to numbers
you have verified in the console — which is all a demo needs.

1. Sign up at twilio.com and verify **your own** number under *Verified Caller
   IDs*.
2. Get a trial phone number from the console.
3. Copy the **Account SID** and **Auth Token** from the dashboard.
4. In `app/.env`:

   ```
   SMS_PROVIDER=twilio
   SMS_API_KEY=ACxxxxxxxxxxxxxxxx:your_auth_token
   SMS_SENDER_ID=+15551234567
   ```

5. Restart the API. The response to `POST /v1/auth/otp/request` will now carry
   `"channel": "twilio"` and **no** `devOtp`, and the code arrives by SMS.

Trial messages are prefixed with a Twilio notice. That is the trial, not a bug.

> Do not paste credentials into a chat, a commit, or an issue. `.env` is
> gitignored and `gitleaks` runs in CI, but neither helps once a key has been
> pasted somewhere public. If one leaks, rotate it in the Twilio console.

### The real path in India, and why it is slow

Sending A2P SMS to Indian numbers requires **TRAI DLT registration**:

- a registered legal entity, with documents;
- a registered **sender ID** (the six-character header, e.g. `RDASST`);
- every **message template** approved in advance, with variables declared.

This applies to Twilio as much as to MSG91 — it is the regulator, not the
vendor. It takes days to weeks and needs a real business entity, so it is not
something a student project can complete in an afternoon. The code is ready for
it: `msg91` is implemented against the DLT Flow API, and `SMS_DLT_TEMPLATE_ID` /
`SMS_DLT_VAR` exist precisely because Indian messages are template-bound.

**For a review or a demo, use the Twilio trial path.** Say plainly that
production delivery to arbitrary Indian numbers is gated on DLT registration
rather than on code — that is a better answer than a vague one, and it is true.

### Verifying it without any account

The adapters were checked against a stub speaking Twilio's wire format, which is
also how you can test a change without credentials:

```bash
SMS_PROVIDER=twilio \
SMS_API_KEY="ACtest:token" \
SMS_SENDER_ID="+15550001111" \
SMS_BASE_URL="http://127.0.0.1:8787" \
npm start
```

Point `SMS_BASE_URL` at anything that accepts
`POST /2010-04-01/Accounts/{SID}/Messages.json` and prints the form body. You
will see a different six-digit code each time, and none of them in the HTTP
response.

---

## Checklist

- [ ] `npm start`, then `npm run share`, and open the printed HTTPS URL
- [ ] Android: put that URL in **API base URL**
- [ ] Twilio trial account, own number verified, trial number obtained
- [ ] `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID` in `app/.env`
- [ ] Restart the API; confirm the response has `"channel": "twilio"` and no `devOtp`
- [ ] Sign in with the code from the SMS
