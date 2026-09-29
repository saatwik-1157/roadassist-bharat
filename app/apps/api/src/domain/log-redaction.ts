/**
 * What the console SMS provider may print.
 *
 * The console provider is not only a development tool: the hosted demo runs on
 * it, and its stdout is the host's log stream. Printed in full, every line was a
 * phone number, a live sign-in code or the text of somebody's emergency — in a
 * log that more people can read than should.
 *
 * In development and test nothing changes: developers read their sign-in codes
 * from exactly this output. Everywhere else the number keeps only its last four
 * digits and any six-digit code in the body is replaced.
 */

/** Environments whose console output is a developer's own terminal. */
export function isDeveloperConsole(nodeEnv: string): boolean {
  return nodeEnv === "development" || nodeEnv === "test";
}

/** `+919876543210` → `+91******3210`. Anything shorter than five digits is hidden entirely. */
export function maskMsisdn(msisdn: string): string {
  const digits = msisdn.replace(/\D/g, "");
  if (digits.length < 5) return "****";
  const prefix = msisdn.startsWith("+91") ? "+91" : msisdn.startsWith("+") ? "+" : "";
  const rest = prefix === "+91" ? digits.slice(2) : digits;
  // "+91" plus four digits or fewer: the last four would be all of them, and
  // three or fewer threw a RangeError from repeat(-1) inside the SMS provider.
  if (rest.length <= 4) return prefix + "****";
  return prefix + "*".repeat(rest.length - 4) + rest.slice(-4);
}

/**
 * Replace every standalone six-digit run — the shape of every OTP this
 * platform issues. Longer digit runs (a phone number, a reference) are left
 * alone, so the redaction removes codes without shredding the rest.
 */
export function redactCodes(body: string): string {
  return body.replace(/(?<!\d)\d{6}(?!\d)/g, "••••••");
}

/** `someone@example.com` → `s***@example.com`. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  return at < 1 ? "***" : `${address[0]}***${address.slice(at)}`;
}

/** What the console EMAIL provider prints: same rule — sign-in codes and addresses masked. */
export function consoleEmailLine(to: string | string[], subject: string, body: string, nodeEnv: string): string {
  const dev = isDeveloperConsole(nodeEnv);
  const shownTo = [to].flat().map((a) => (dev ? a : maskEmail(a))).join(", ");
  const shownBody = dev ? body : redactCodes(body);
  return `[email:console] → ${shownTo}\n  subject: ${dev ? subject : redactCodes(subject)}\n  ${shownBody.replace(/\n/g, "\n  ")}`;
}

/** The line the console provider prints for one message. */
export function consoleSmsLine(to: string, body: string, nodeEnv: string): string {
  const shownTo = isDeveloperConsole(nodeEnv) ? to : maskMsisdn(to);
  const shownBody = isDeveloperConsole(nodeEnv) ? body : redactCodes(body);
  return `[sms:console] → ${shownTo}\n            ${shownBody.replace(/\n/g, "\n            ")}`;
}
