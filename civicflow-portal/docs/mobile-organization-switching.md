# Mobile Organization Switching

How the mobile app selects and switches organizations, and what's additive
vs. required for compatibility with older app builds.

## Organization list (`GET /api/mobile/organizations`)

Returns every organization the caller can meaningfully open, merged from
three identities (regular member, PTA household adult, PTA officer — see
the route's own doc comment for why these three and not "any staff role in
any org"). Each row is additive-only as of this work: existing fields are
unchanged, and a new `capability` object was added:

```ts
capability: {
  primaryVertical,       // effective vertical (see resolveEffectiveVertical)
  terminology: { productLabel, member, dashboardTitle },
  quickActions: [{ href, label }],
  supportedModules: string[],  // which of the app's fixed tabs apply
  landingPage: "dashboard",    // tab name, not a web path
}
```

An older mobile build that doesn't know about `capability` simply never
reads it — nothing about the existing response shape changed, and the
"Volunteer" tab's visibility still keys off the pre-existing `pta` field
exactly as before.

## No vertical selection at login

The mobile app never asks "choose PTA / Union / HOA" as a separate step.
Login → organization list → (if more than one) organization selector →
selection sends only the organization ID → server resolves and returns that
organization's capability.

## Switching

The client sends `organizationId`; the server is the only source of
`primaryVertical` and everything derived from it. A client-supplied vertical
value, if an older or malicious client ever sent one, is not part of the
accepted request shape and is ignored.

On switch, the client is expected to clear: the prior organization's cached
capability, tab state, and any deep-link target that assumed the previous
organization's vertical — the same "no stale context" requirement as web.

## Known limitation

No new mobile screens were built as part of this work — the fixed tab set
(Home, Inbox, Announcements, Payments, Events, Volunteer [PTA-only],
Profile) is unchanged. `capability.quickActions`/`supportedModules` prepare
a future mobile release to adapt tab labels and available actions per
vertical without another API change, but the current app version doesn't
yet consume those specific fields.
