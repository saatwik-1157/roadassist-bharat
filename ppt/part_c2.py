

# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 13 — M2 SERVICE TECHNOLOGY IN PRACTICE: THE PAYMENT GATEWAY
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "CONSUMING A CLOUD SERVICE: PAYMENTS",
            eyebrow="MODULE 2 · SERVICE TECHNOLOGY IN PRACTICE", size=30, badge=IMPL)

# ── the consumer / provider boundary, which is the Module 1 idea made concrete
panel(s, 0.85, 2.3, 5.5, 0.52, fill=INK_3, line_col=GREEN, line_w=1.3)
txt(s, 1.05, 2.42, 5.1, 0.3, "ROADASSIST  —  cloud consumer", size=11, color=GREEN,
    bold=True, font=SANS_SEMI)
panel(s, 0.85, 5.62, 5.5, 0.52, fill=INK_3, line_col=BLUE, line_w=1.3)
txt(s, 1.05, 5.74, 5.1, 0.3, "RAZORPAY  —  cloud provider (SaaS)", size=11, color=BLUE,
    bold=True, font=SANS_SEMI)

flow = [("1  Invoice created", "Amount is the invoice total.\nNever read from the request.", GREEN),
        ("2  Create order", "Server-to-server, HTTP Basic.\nPOST /v1/orders", CYAN),
        ("3  Checkout opens", "Client gets the key ID only.\nThe key SECRET never leaves us.", CYAN),
        ("4  Signature verified", "HMAC-SHA256(order|payment).\nNo match, no settlement.", AMBER)]
y = 2.95
for t, d, c in flow:
    node(s, 0.85, y, 5.5, 0.6, t, d, color=c, tsize=10.5, ssize=8)
    if y < 4.9:
        arrow(s, 3.6, y + 0.62, 3.6, y + 0.66, color=c, width=1.2)
    y += 0.68

# ── the reliability argument ─────────────────────────────────────────────────
panel(s, 6.6, 2.3, 5.85, 2.05, fill=INK_2, line_col=CYAN, line_w=1.2)
txt(s, 6.85, 2.46, 5.4, 0.3, "TWO SETTLEMENT PATHS — ON PURPOSE", size=10.5,
    color=CYAN, bold=True, spacing=1.4)
node(s, 6.85, 2.82, 5.35, 0.6, "BROWSER CALLBACK",
     "POST /v1/payments/:id/confirm — the client returns the signed payload",
     color=GREY_DIM, tsize=10, ssize=8)
node(s, 6.85, 3.52, 5.35, 0.68, "WEBHOOK  ·  the one that matters",
     "POST /v1/webhooks/razorpay — signature over the raw body IS the auth",
     color=GREEN, tsize=10, ssize=8)

panel(s, 6.6, 4.5, 5.85, 1.02, fill=INK_2, line_col=AMBER, line_w=1.2)
txt(s, 6.85, 4.64, 5.4, 0.3, "WHY A WEBHOOK AT ALL?", size=10.5, color=AMBER,
    bold=True, spacing=1.4)
txt(s, 6.85, 4.92, 5.4, 0.55,
    "A customer can pay and immediately close the tab, lose signal, or have the page "
    "killed. The money has still moved. The browser is not a reliable narrator, so "
    "settlement cannot depend on it.",
    size=9.5, color=GREY, line=1.3)

txt(s, 6.6, 5.68, 5.85, 0.3, "VERIFIED — 22 AUTOMATED CHECKS", size=10, color=GREEN,
    bold=True, spacing=1.4)
for i, (t, c) in enumerate([("Forged signature refused", RED), ("Unsigned webhook 401", RED),
                            ("Amount mismatch refused", AMBER), ("Replay settles once", GREEN)]):
    chip(s, 6.6 + (i % 2) * 2.98, 5.98 + (i // 2) * 0.4, 2.85, 0.34, t,
         color=c, size=8, fill=INK_2)

panel(s, 0.85, 6.44, 5.5, 0.34, fill=INK_2, line_col=AMBER, line_w=1.0)
txt(s, 1.05, 6.52, 5.1, 0.24,
    "Default provider is mock. Live keys need a KYC-verified account.",
    size=8.5, color=AMBER)
module_rail(s, 2); page_no(s)
notes(s, """MEANING
Module 2's service technology, made concrete. This is the one slide where RoadAssist is visibly a cloud CONSUMER of somebody else's SaaS, which is the Module 1 roles-and-boundaries idea in action.

SAY
"This is service technology in practice. Payments are not something we built - they are a cloud service we consume. Razorpay is the provider, we are the consumer, and the boundary between us is a set of web APIs. Follow the flow on the left. The invoice total is the amount; it is never read from the request, so a client cannot choose what it owes. We create the order server to server. The browser receives only the key ID - the key secret never leaves our server. And when checkout finishes, the signature is re-computed on our side before anything settles."

THE POINT ABOUT THE WEBHOOK
"On the right is the design decision I would most like to be asked about. There are two settlement paths. The browser callback is convenient. The webhook is the one that matters, because a customer can pay and immediately close the tab, and the money has still moved. If settlement depended on their browser surviving, we would take real money and never close the invoice. Razorpay retries the webhook until it gets a 2xx, so that is the path that actually guarantees correctness."

CONCEPT DEMONSTRATED
Module 2 - service technology (a capability consumed as an independent service over web APIs). Module 1 - cloud consumer and cloud provider roles, and the boundary between them. Module 3 - the network perimeter, since the webhook is authenticated by signature rather than by a session.

RELATION TO ROADASSIST
Implemented and tested: 22 automated assertions against a local stub of the Orders API - no account and no money needed to prove it. The default provider is 'mock', which settles locally; production refuses to boot on a real gateway with no webhook secret configured.

IF ASKED
"Why is the webhook authenticated differently from the rest of your API?" - Because Razorpay has no user session and no bearer token to present. The signature over the raw request body IS the authentication. That is also why our JSON parser retains the raw body: a re-serialised body would produce a different hash.

IF ASKED
"How do you stop someone paying one rupee for a four-hundred rupee job?" - Three ways. The amount is taken from the invoice, not the request. The signature covers the order id, so a payment cannot be re-pointed at a different order. And the webhook re-checks the captured amount against the invoice and refuses a mismatch with a 409.

IF ASKED
"Is this live?" - The integration is complete and tested against a stub. Live keys require a KYC-verified Razorpay business account, so the deck does not claim live transactions.

TRANSITION
"That completes Module 2. Module 3 goes one level deeper, into the infrastructure mechanisms themselves."
""")
