type NeedsYouReason = "captcha" | "login" | "review";

const NEEDS_YOU_TITLE = "Needs you";
const REASON_PREFIX: Record<NeedsYouReason, string> = {
  captcha: "CAPTCHA on",
  login: "Sign in on",
  review: "Review the message on",
};

const ignoreToastResult = () => undefined;

export async function notifyNeedsYou(input: { host: string; company: string; reason: NeedsYouReason }): Promise<void> {
  if (process.env.APPLY_NOTIFY === "false") return;
  try {
    const { default: notifier } = await import("node-notifier");
    notifier.notify({ title: NEEDS_YOU_TITLE, message: `${REASON_PREFIX[input.reason]} ${input.host} for ${input.company}` }, ignoreToastResult);
  } catch {
    return;
  }
}
