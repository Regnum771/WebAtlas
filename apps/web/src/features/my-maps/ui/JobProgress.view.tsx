import type { Job, JobStep } from '../api/workspace.api';

const STATE_WORD: Record<JobStep['status'], string> = {
  pending: 'Chờ',
  running: 'Đang chạy',
  done: 'Xong',
  failed: 'Lỗi',
};

/** Passive: a worker job's progress bar and its steps, labelled as the API sends them. */
export function JobProgressView({ job }: { job: Job }) {
  return (
    <div className="job-progress">
      <progress className="job-progress-bar" max={100} value={job.progress} aria-label="Tiến độ" />
      <ol className="job-steps">
        {job.steps.map((step) => (
          <li key={step.key} className={`job-step ${step.status}`}>
            <span className="job-step-label">{step.label}</span>
            <span className="job-step-state">{STATE_WORD[step.status]}</span>
            {step.message && <p className="job-step-message">{step.message}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
