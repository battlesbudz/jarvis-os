import type { Request, Response } from "express";

export function registerCoachRunLifecycle(input: {
  req: Pick<Request, "on">;
  res: Pick<Response, "on" | "writableEnded">;
  cleanupRun: () => void;
  markClientDisconnected: () => void;
  stopVisibleProgress: () => void;
}): void {
  const {
    req,
    res,
    cleanupRun,
    markClientDisconnected,
    stopVisibleProgress,
  } = input;

  req.on("aborted", () => {
    markClientDisconnected();
    cleanupRun();
  });

  res.on("close", () => {
    stopVisibleProgress();
    if (!res.writableEnded) {
      markClientDisconnected();
      cleanupRun();
    }
  });

  res.on("finish", () => {
    stopVisibleProgress();
    cleanupRun();
  });
}
