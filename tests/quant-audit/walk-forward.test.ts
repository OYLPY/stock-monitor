import { describe, expect, it } from "vitest";

import { runWalkForwardValidation } from "@/features/validation/walk-forward";
import type { WalkForwardPlan } from "@/features/validation/walk-forward";

function businessSessions(count: number) {
  const sessions: { date: string; value: number }[] = [];
  const date = new Date("2025-01-01T00:00:00.000Z");
  while (sessions.length < count) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      sessions.push({
        date: date.toISOString().slice(0, 10),
        value: sessions.length,
      });
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return sessions;
}

function plan(overrides: Partial<WalkForwardPlan> = {}): WalkForwardPlan {
  return {
    trainingWindow: { kind: "EXPANDING", initialSessions: 4 },
    testSessions: 62,
    stepSessions: 62,
    bootstrapBlockLength: 5,
    embargoSessions: 1,
    ...overrides,
  };
}

function tradesFor(sessions: readonly { date: string }[], limit = 31) {
  return Array.from({ length: limit }, (_, index) => {
    const entry = sessions[index * 2];
    const exit = sessions[index * 2 + 1];
    if (!entry || !exit) throw new RangeError("missing_fixture_session");
    return {
      id: `trade:${entry.date}`,
      entryDate: entry.date,
      exitDate: exit.date,
      netReturnBps: index % 3 === 0 ? 100 : index % 3 === 1 ? -50 : 0,
    };
  });
}

describe("runWalkForwardValidation", () => {
  it("keeps each selection on prior sessions and produces deterministic demo reports", () => {
    const source = businessSessions(129);
    const selections: string[][] = [];
    const report = runWalkForwardValidation({
      sessions: source,
      plan: plan(),
      strategyVersion: "fixture-strategy-v1",
      selectionRuleVersion: "train-only-rule-v1",
      selectParameters: (trainingSessions) => {
        selections.push(trainingSessions.map(({ date }) => date));
        expect(Object.isFrozen(trainingSessions)).toBe(true);
        expect(Object.isFrozen(trainingSessions[0])).toBe(true);
        const parameters = {
          trainingValueSum: trainingSessions.reduce(
            (sum, { value }) => sum + value,
            0,
          ),
        };
        return {
          parameters,
          attempts: [
            {
              id: `attempt-${trainingSessions.length}`,
              parameters,
              trainingScoreBps: 5,
              selected: true,
            },
          ],
        };
      },
      evaluate: ({ outOfSampleSessions }) => ({
        backtestEngineVersion: "backtest-engine-v1",
        resultClass: "DEMO_ONLY",
        closedTrades: tradesFor(outOfSampleSessions),
        openPositionCount: 0,
      }),
    });
    const replay = runWalkForwardValidation({
      sessions: source,
      plan: plan(),
      strategyVersion: "fixture-strategy-v1",
      selectionRuleVersion: "train-only-rule-v1",
      selectParameters: (trainingSessions) => {
        const parameters = {
          trainingValueSum: trainingSessions.reduce(
            (sum, { value }) => sum + value,
            0,
          ),
        };
        return {
          parameters,
          attempts: [
            {
              id: `attempt-${trainingSessions.length}`,
              parameters,
              trainingScoreBps: 5,
              selected: true,
            },
          ],
        };
      },
      evaluate: ({ outOfSampleSessions }) => ({
        backtestEngineVersion: "backtest-engine-v1",
        resultClass: "DEMO_ONLY",
        closedTrades: tradesFor(outOfSampleSessions),
        openPositionCount: 0,
      }),
    });
    const changedFuture = source.map((session, index) =>
      index >= 5 ? { ...session, value: session.value + 10_000 } : session,
    );
    const futureChangedReport = runWalkForwardValidation({
      sessions: changedFuture,
      plan: plan(),
      strategyVersion: "fixture-strategy-v1",
      selectionRuleVersion: "train-only-rule-v1",
      selectParameters: (trainingSessions) => {
        const parameters = {
          trainingValueSum: trainingSessions.reduce(
            (sum, { value }) => sum + value,
            0,
          ),
        };
        return {
          parameters,
          attempts: [
            {
              id: "future-change-test",
              parameters,
              trainingScoreBps: 5,
              selected: true,
            },
          ],
        };
      },
      evaluate: ({ outOfSampleSessions }) => ({
        backtestEngineVersion: "backtest-engine-v1",
        resultClass: "DEMO_ONLY",
        closedTrades: tradesFor(outOfSampleSessions),
        openPositionCount: 0,
      }),
    });

    expect(report.folds).toHaveLength(2);
    expect(selections[0]).toHaveLength(4);
    expect(Date.parse(`${selections[0]?.at(-1)}T00:00:00.000Z`)).toBeLessThan(
      Date.parse(`${report.folds[0]?.testStartDate}T00:00:00.000Z`),
    );
    expect(report.folds[0]?.embargoDates).toHaveLength(1);
    expect(report.folds[1]?.trainingSessions).toBe(66);
    expect(report.folds[0]?.resultClass).toBe("DEMO_ONLY");
    expect(report.summary).toEqual(replay.summary);
    expect(report.summary.tradeCount).toBe(62);
    expect(
      report.folds[0]?.summary.bootstrapMeanNetReturnBps95Ci,
    ).toMatchObject({
      method: "CIRCULAR_BLOCK",
      blockLength: 5,
      replicates: 1_000,
    });
    expect(report.inputHashSha256).toBe(replay.inputHashSha256);
    expect(report.inputHashSha256).not.toBe(
      futureChangedReport.inputHashSha256,
    );
    expect(report.folds[0]?.parametersHashSha256).toBe(
      futureChangedReport.folds[0]?.parametersHashSha256,
    );
    expect(report.folds[1]?.parametersHashSha256).not.toBe(
      futureChangedReport.folds[1]?.parametersHashSha256,
    );
    expect(
      report.folds.map(({ parametersHashSha256 }) => parametersHashSha256),
    ).toEqual(
      replay.folds.map(({ parametersHashSha256 }) => parametersHashSha256),
    );
  });

  it("marks fewer than 30 closed out-of-sample trades NOT_VERIFIED", () => {
    const source = businessSessions(34);
    const report = runWalkForwardValidation({
      sessions: source,
      plan: { ...plan(), testSessions: 29, stepSessions: 29 },
      strategyVersion: "fixture-strategy-v1",
      selectionRuleVersion: "train-only-rule-v1",
      selectParameters: () => {
        const parameters = { threshold: 10 };
        return {
          parameters,
          attempts: [
            {
              id: "only-attempt",
              parameters,
              trainingScoreBps: null,
              selected: true,
            },
          ],
        };
      },
      evaluate: ({ outOfSampleSessions }) => ({
        backtestEngineVersion: "backtest-engine-v1",
        resultClass: "VERIFIED",
        closedTrades: tradesFor(outOfSampleSessions, 5),
        openPositionCount: 0,
      }),
    });

    expect(report.resultClass).toBe("NOT_VERIFIED");
    expect(report.reasons).toContain("INSUFFICIENT_OOS_TRADES");
    expect(report.folds[0]?.summary.winRate).toBe(0.4);
    expect(report.folds[0]?.summary.bootstrapMeanNetReturnBps95Ci).toBeNull();
  });

  it("uses only the configured recent training sessions for rolling windows", () => {
    const source = businessSessions(25);
    const observedTraining: string[][] = [];
    const report = runWalkForwardValidation({
      sessions: source,
      plan: {
        trainingWindow: { kind: "ROLLING", sessions: 4 },
        testSessions: 10,
        stepSessions: 10,
        bootstrapBlockLength: 5,
        embargoSessions: 1,
      },
      strategyVersion: "fixture-strategy-v1",
      selectionRuleVersion: "train-only-rule-v1",
      selectParameters: (trainingSessions) => {
        observedTraining.push(trainingSessions.map(({ date }) => date));
        const parameters = { trainingCount: trainingSessions.length };
        return {
          parameters,
          attempts: [
            {
              id: `attempt-${observedTraining.length}`,
              parameters,
              trainingScoreBps: null,
              selected: true,
            },
          ],
        };
      },
      evaluate: () => ({
        backtestEngineVersion: "backtest-engine-v1" as const,
        resultClass: "DEMO_ONLY",
        closedTrades: [],
        openPositionCount: 0,
      }),
    });

    expect(report.folds).toHaveLength(2);
    expect(observedTraining[0]).toEqual(
      source.slice(0, 4).map(({ date }) => date),
    );
    expect(observedTraining[1]).toEqual(
      source.slice(10, 14).map(({ date }) => date),
    );
  });

  it("does not validate a fold with an open position at the test boundary", () => {
    const report = runWalkForwardValidation({
      sessions: businessSessions(67),
      plan: plan(),
      strategyVersion: "fixture-strategy-v1",
      selectionRuleVersion: "train-only-rule-v1",
      selectParameters: () => {
        const parameters = { threshold: 10 };
        return {
          parameters,
          attempts: [
            { id: "attempt", parameters, trainingScoreBps: 1, selected: true },
          ],
        };
      },
      evaluate: ({ outOfSampleSessions }) => ({
        backtestEngineVersion: "backtest-engine-v1",
        resultClass: "VERIFIED",
        closedTrades: tradesFor(outOfSampleSessions),
        openPositionCount: 1,
      }),
    });

    expect(report.resultClass).toBe("NOT_VERIFIED");
    expect(report.reasons).toContain("OPEN_POSITIONS_OMITTED");
  });

  it("rejects overlapping test folds and an unrecorded selected configuration", () => {
    const source = businessSessions(80);
    const base = {
      sessions: source,
      strategyVersion: "fixture-strategy-v1",
      selectionRuleVersion: "train-only-rule-v1",
      selectParameters: () => {
        const parameters = { threshold: 10 };
        return {
          parameters,
          attempts: [
            { id: "attempt", parameters, trainingScoreBps: 1, selected: true },
          ],
        };
      },
      evaluate: () => ({
        backtestEngineVersion: "backtest-engine-v1" as const,
        resultClass: "DEMO_ONLY" as const,
        closedTrades: [],
        openPositionCount: 0,
      }),
    };

    expect(() =>
      runWalkForwardValidation({
        ...base,
        plan: { ...plan(), stepSessions: 30 },
      }),
    ).toThrow("overlapping_out_of_sample_windows");
    expect(() =>
      runWalkForwardValidation({
        ...base,
        plan: plan(),
        selectParameters: () => ({
          parameters: { threshold: 10 },
          attempts: [
            {
              id: "attempt",
              parameters: { threshold: 20 },
              trainingScoreBps: 1,
              selected: true,
            },
          ],
        }),
      }),
    ).toThrow("selected_parameters_must_match_one_attempt");
  });

  it("does not claim a resampling interval when a fold cannot form two blocks", () => {
    const report = runWalkForwardValidation({
      sessions: businessSessions(67),
      plan: { ...plan(), bootstrapBlockLength: 31 },
      strategyVersion: "fixture-strategy-v1",
      selectionRuleVersion: "train-only-rule-v1",
      selectParameters: () => {
        const parameters = { threshold: 10 };
        return {
          parameters,
          attempts: [
            { id: "attempt", parameters, trainingScoreBps: 1, selected: true },
          ],
        };
      },
      evaluate: ({ outOfSampleSessions }) => ({
        backtestEngineVersion: "backtest-engine-v1",
        resultClass: "VERIFIED",
        closedTrades: tradesFor(outOfSampleSessions),
        openPositionCount: 0,
      }),
    });

    expect(report.resultClass).toBe("NOT_VERIFIED");
    expect(report.reasons).toContain("INSUFFICIENT_RESAMPLING_BLOCKS");
    expect(report.folds[0]?.summary.bootstrapMeanNetReturnBps95Ci).toBeNull();
  });

  it("does not run a selector when the sessions cannot form a full test fold", () => {
    let selected = false;
    const report = runWalkForwardValidation({
      sessions: businessSessions(10),
      plan: plan(),
      strategyVersion: "fixture-strategy-v1",
      selectionRuleVersion: "train-only-rule-v1",
      selectParameters: () => {
        selected = true;
        return {
          parameters: {},
          attempts: [
            {
              id: "unused",
              parameters: {},
              trainingScoreBps: null,
              selected: true,
            },
          ],
        };
      },
      evaluate: () => ({
        backtestEngineVersion: "backtest-engine-v1",
        resultClass: "DEMO_ONLY",
        closedTrades: [],
        openPositionCount: 0,
      }),
    });

    expect(selected).toBe(false);
    expect(report.resultClass).toBe("NOT_VERIFIED");
    expect(report.reasons).toEqual(["INSUFFICIENT_SESSIONS"]);
    expect(report.folds).toHaveLength(0);
  });
});
