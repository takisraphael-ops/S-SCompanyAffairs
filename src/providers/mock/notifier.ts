import type { Notification, Notifier } from "../types";

/**
 * Delivery to the log.
 *
 * The default, and the one that makes the alerts page the product rather than
 * a consolation prize. A rule with `channel = inbox` is delivered by being
 * written to `alert_events`, which the UI reads — nothing has to leave the
 * machine for the feature to work, and no key is needed to try it.
 *
 * This adapter exists for the `email` channel when no email provider is
 * configured: the message is printed rather than silently dropped, so a cron
 * log shows exactly what would have been sent. Marking the row delivered
 * would be a lie, so the caller records which notifier accepted it.
 */
export class ConsoleNotifier implements Notifier {
  readonly name = "console";

  async send(message: Notification): Promise<void> {
    console.log(
      `[notify] ${message.subject}\n${message.body
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n")}`,
    );
  }
}
