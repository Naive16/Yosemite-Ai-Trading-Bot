export class WorkerConfigurationError extends Error {
  constructor(message) { super(message); this.name = "WorkerConfigurationError"; }
}

export class WorkerLifecycle {
  constructor({ workerId, heartbeatIntervalSeconds = 30, now = () => new Date() } = {}) {
    if (typeof workerId !== "string" || !/^[A-Za-z0-9._-]{3,128}$/.test(workerId)) throw new WorkerConfigurationError("Worker ID is invalid");
    if (!Number.isInteger(heartbeatIntervalSeconds) || heartbeatIntervalSeconds < 15 || heartbeatIntervalSeconds > 3_600) throw new WorkerConfigurationError("Heartbeat interval is invalid");
    this.workerId = workerId;
    this.heartbeatIntervalSeconds = heartbeatIntervalSeconds;
    this.now = now;
    this.state = "stopped";
    this.startedAt = null;
    this.lastHeartbeatAt = null;
    this.stoppedAt = null;
    this.stopReason = null;
    this.acceptedJobs = new Set();
  }

  start() {
    if (this.state === "running") return this.snapshot();
    this.state = "running";
    this.startedAt = this.now();
    this.stoppedAt = null;
    this.stopReason = null;
    return this.heartbeat();
  }

  heartbeat() {
    if (this.state !== "running") throw new WorkerConfigurationError("Worker is not running");
    this.lastHeartbeatAt = this.now();
    return this.snapshot();
  }

  acceptJob(jobId) {
    if (this.state !== "running") throw new WorkerConfigurationError("Worker is not running");
    if (typeof jobId !== "string" || jobId.length < 1 || jobId.length > 200) throw new WorkerConfigurationError("Job ID is invalid");
    if (this.acceptedJobs.has(jobId)) return { status: "duplicate", jobId };
    this.acceptedJobs.add(jobId);
    return { status: "accepted", jobId, executionAllowed: false, reason: "worker_execution_disabled" };
  }

  stop(reason = "shutdown") {
    if (this.state === "stopped") return this.snapshot();
    this.state = "stopped";
    this.stoppedAt = this.now();
    this.stopReason = typeof reason === "string" && reason.length <= 200 ? reason : "shutdown";
    return this.snapshot();
  }

  snapshot(at = this.now()) {
    const lastHeartbeatAt = this.lastHeartbeatAt?.toISOString() || null;
    const heartbeatAgeSeconds = this.lastHeartbeatAt ? Math.max(0, (at.getTime() - this.lastHeartbeatAt.getTime()) / 1_000) : null;
    return Object.freeze({ workerId: this.workerId, state: this.state, startedAt: this.startedAt?.toISOString() || null, lastHeartbeatAt, heartbeatAgeSeconds, healthy: this.state === "running" && heartbeatAgeSeconds != null && heartbeatAgeSeconds <= this.heartbeatIntervalSeconds * 2, stoppedAt: this.stoppedAt?.toISOString() || null, stopReason: this.stopReason, acceptedJobCount: this.acceptedJobs.size, executionAllowed: false });
  }
}
