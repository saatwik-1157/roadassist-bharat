/**
 * How long a model-detected incident may wait for a human, and what happens
 * when it waits too long.
 *
 * ADR-0005 forbids a model dispatching anyone: a crash signal lands in
 * AWAITING_CONFIRMATION and there is no transition out of it that does not pass
 * through a person. That rule is sound and is not relaxed here.
 *
 * It has a mirror failure, though, and the state machine had no answer for it:
 * *nobody ever arrives*. `AWAITING_CONFIRMATION` offers exactly `confirm` and
 * `cancel`, both of which need a human, so a RAKSHA signal raised at 3am on an
 * empty corridor waits indefinitely and nothing surfaces it. A false positive
 * that dispatches is worse than a false negative that asks — but a question
 * nobody is asked is not a question.
 *
 * The fix deliberately adds NO state and NO transition. An overdue incident has
 * not changed; our obligation to look at it has. So "overdue" is derived here
 * from the stored status, severity and age, and the review queue is ordered by
 * it. Nothing in this file can cause a dispatch, which is what keeps ADR-0005
 * true by construction rather than by review.
 *
 * ADR-0011.
 */

export type IncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * Minutes a signal of each severity may sit unconfirmed.
 *
 * These are review targets, not response targets, and they are deliberately
 * short: the cost of breaching one is that somebody looks at a screen, so the
 * conservative direction is to ask too often rather than too late. They are not
 * derived from field data because there is none — this is a student project
 * with no deployment, and saying so is cheaper than implying a study.
 */
export const REVIEW_SLA_MINUTES: Record<IncidentSeverity, number> = {
  CRITICAL: 5,
  HIGH: 15,
  MEDIUM: 60,
  LOW: 240,
};

/** Only an unconfirmed incident is waiting on anybody. */
export const AWAITING_REVIEW_STATUS = "AWAITING_CONFIRMATION";

export type ReviewState =
  | "NOT_AWAITING"   // confirmed, cancelled, resolved — nobody is waiting on us
  | "WITHIN_SLA"     // waiting, and still inside its window
  | "OVERDUE";       // waiting longer than its severity allows

export interface ReviewAssessment {
  state: ReviewState;
  /** Whole minutes the incident has been waiting. Zero when not awaiting. */
  waitedMinutes: number;
  /** The moment it becomes OVERDUE. Null when not awaiting. */
  deadline: Date | null;
  /** Minutes remaining; negative once breached. Null when not awaiting. */
  minutesToDeadline: number | null;
  slaMinutes: number;
}

/** When a signal of this severity, raised then, stops being acceptable to ignore. */
export function reviewDeadline(detectedAt: Date, severity: IncidentSeverity): Date {
  return new Date(detectedAt.getTime() + REVIEW_SLA_MINUTES[severity] * 60_000);
}

/**
 * The whole rule, as one pure function.
 *
 * `now` is a parameter rather than read from the clock so the behaviour is
 * testable without waiting five minutes for a CRITICAL to breach.
 */
export function assessReview(
  status: string,
  detectedAt: Date,
  severity: IncidentSeverity,
  now: Date,
): ReviewAssessment {
  const slaMinutes = REVIEW_SLA_MINUTES[severity];

  if (status !== AWAITING_REVIEW_STATUS) {
    return { state: "NOT_AWAITING", waitedMinutes: 0, deadline: null, minutesToDeadline: null, slaMinutes };
  }

  const deadline = reviewDeadline(detectedAt, severity);
  const waitedMs = now.getTime() - detectedAt.getTime();
  // A clock skewed backwards must not read as "waiting a negative time", which
  // would sort a fresh incident above a breached one in the queue.
  const waitedMinutes = Math.max(0, Math.floor(waitedMs / 60_000));
  const minutesToDeadline = Math.ceil((deadline.getTime() - now.getTime()) / 60_000);

  return {
    // Exactly at the deadline is overdue: the window is what it may wait, not
    // what it may wait and then some.
    state: now.getTime() >= deadline.getTime() ? "OVERDUE" : "WITHIN_SLA",
    waitedMinutes,
    deadline,
    minutesToDeadline,
    slaMinutes,
  };
}

/** Did this incident breach its review window? Convenience over `assessReview`. */
export function isReviewOverdue(
  status: string,
  detectedAt: Date,
  severity: IncidentSeverity,
  now: Date,
): boolean {
  return assessReview(status, detectedAt, severity, now).state === "OVERDUE";
}

/**
 * Queue order: the most neglected first.
 *
 * Severity breaks ties rather than leading, because a HIGH that has waited an
 * hour is more urgent than a CRITICAL raised ten seconds ago — the point of the
 * queue is to surface what has been ignored, not to re-rank by seriousness.
 */
export const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1,
};

export function compareReviewUrgency(
  a: { assessment: ReviewAssessment; severity: IncidentSeverity },
  b: { assessment: ReviewAssessment; severity: IncidentSeverity },
): number {
  const overdue = Number(b.assessment.state === "OVERDUE") - Number(a.assessment.state === "OVERDUE");
  if (overdue !== 0) return overdue;
  const waited = b.assessment.waitedMinutes - a.assessment.waitedMinutes;
  if (waited !== 0) return waited;
  return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
}
